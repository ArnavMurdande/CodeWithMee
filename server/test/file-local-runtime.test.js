'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { mkdtemp, rm } = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const express = require('express');

const { FILE_SCAN_STATUS, FILE_STATE } = require('../modules/files/contracts');
const { createLocalObjectStore } = require('../modules/files/local-object-store');
const { createMemoryFileRepository } = require('../modules/files/memory-repository');
const { createFileService } = require('../modules/files/service');
const { loadFileStorageConfig } = require('../modules/files/runtime');
const { createRelatedFileAuthorizer } = require('../modules/files/runtime-module');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const authentication = Object.freeze({ principal: Object.freeze({ userId: USER_ID }) });

function digest(body) {
  return createHash('sha256').update(body).digest('hex');
}

async function listen(router) {
  const app = express();
  app.use('/api/v1/file-objects', router);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

test('local development storage is enabled explicitly and forbidden in production', () => {
  const config = loadFileStorageConfig({ FILE_STORAGE_MODE: 'local' });
  assert.equal(config.enabled, true);
  assert.equal(config.provider, 'local');
  assert.equal(config.scannerMode, 'local');
  assert.throws(
    () => loadFileStorageConfig({ FILE_STORAGE_MODE: 'local' }, { nodeEnv: 'production' }),
    /forbidden in production/,
  );
});

test('local upload verifies checksum, scans content, and returns a private download', async () => {
  const localRoot = await mkdtemp(path.join(os.tmpdir(), 'cwm-files-'));
  const objectStore = createLocalObjectStore({
    bucket: 'local-test',
    downloadTtlSeconds: 60,
    localRoot,
    prefix: 'codewithmee/test',
    uploadTtlSeconds: 60,
  });
  const repository = createMemoryFileRepository();
  const service = createFileService({ objectStore, repository });
  const listener = await listen(objectStore.httpRouter);
  try {
    const body = Buffer.from('A safe assignment answer.\n');
    const intent = await service.createUploadIntent(authentication, {
      byteSize: body.length,
      declaredMime: 'text/plain',
      originalName: 'answer.txt',
      ownerType: 'user',
      purpose: 'assignment_submission',
      sha256: digest(body),
    });
    const uploaded = await fetch(`${listener.baseUrl}${intent.upload.url}`, {
      body,
      headers: intent.upload.requiredHeaders,
      method: 'PUT',
    });
    assert.equal(uploaded.status, 204);
    const completed = await service.completeUpload(authentication, intent.file.id);
    assert.equal(completed.state, FILE_STATE.READY);
    assert.equal(completed.scanStatus, FILE_SCAN_STATUS.CLEAN);
    const download = await service.createDownload(authentication, intent.file.id);
    const downloaded = await fetch(`${listener.baseUrl}${download.url}`);
    assert.equal(downloaded.status, 200);
    assert.equal(await downloaded.text(), body.toString());
  } finally {
    await listener.close();
    await objectStore.close();
    await rm(localRoot, { force: true, recursive: true });
  }
});

test('local development scanner quarantines the standard antivirus test marker', async () => {
  const localRoot = await mkdtemp(path.join(os.tmpdir(), 'cwm-files-'));
  const objectStore = createLocalObjectStore({
    bucket: 'local-test', downloadTtlSeconds: 60, localRoot, prefix: 'codewithmee/test', uploadTtlSeconds: 60,
  });
  const repository = createMemoryFileRepository();
  const service = createFileService({ objectStore, repository });
  const listener = await listen(objectStore.httpRouter);
  try {
    const body = Buffer.from('EICAR-STANDARD-ANTIVIRUS-TEST-FILE');
    const intent = await service.createUploadIntent(authentication, {
      byteSize: body.length,
      declaredMime: 'text/plain',
      originalName: 'unsafe.txt',
      ownerType: 'user',
      purpose: 'assignment_submission',
      sha256: digest(body),
    });
    const uploaded = await fetch(`${listener.baseUrl}${intent.upload.url}`, {
      body, headers: intent.upload.requiredHeaders, method: 'PUT',
    });
    assert.equal(uploaded.status, 204);
    const completed = await service.completeUpload(authentication, intent.file.id);
    assert.equal(completed.state, FILE_STATE.QUARANTINED);
    assert.equal(completed.scanStatus, FILE_SCAN_STATUS.INFECTED);
  } finally {
    await listener.close();
    await rm(localRoot, { force: true, recursive: true });
  }
});

test('related private files are readable only through exact LMS reviewer relationships', async () => {
  const calls = [];
  const authorize = createRelatedFileAuthorizer({
    async query(sql, values) {
      calls.push({ sql, values });
      return { rowCount: values[0] === 'allowed-file' ? 1 : 0 };
    },
  });
  assert.equal(await authorize({
    action: 'read',
    principal: { userId: USER_ID },
    record: { id: 'allowed-file', purpose: 'payment_proof' },
  }), true);
  assert.equal(await authorize({
    action: 'read',
    principal: { userId: USER_ID },
    record: { id: 'denied-file', purpose: 'assignment_submission' },
  }), false);
  assert.equal(await authorize({
    action: 'write',
    principal: { userId: USER_ID },
    record: { id: 'allowed-file', purpose: 'payment_proof' },
  }), false);
  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /proof_file_id=\$1/);
  assert.match(calls[1].sql, /sf\.file_id=\$1/);
});
