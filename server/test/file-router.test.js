'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { once } = require('node:events');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const express = require('express');

const { createApp } = require('../app');
const { FILE_SCAN_STATUS } = require('../modules/files/contracts');
const { createMemoryFileRepository } = require('../modules/files/memory-repository');
const { createMemoryObjectStore } = require('../modules/files/object-store');
const { createFileRouter } = require('../modules/files/router');
const { createFileService } = require('../modules/files/service');

const ORIGIN = 'https://app.example.test';
const USER_ID = '11111111-1111-4111-8111-111111111111';

function sha256(body) {
  return createHash('sha256').update(body).digest('hex');
}

async function createHarness() {
  const repository = createMemoryFileRepository();
  const objectStore = createMemoryObjectStore();
  const service = createFileService({ objectStore, repository });
  const identityService = {
    async authenticate(token) {
      if (token !== 'valid-token') {
        const error = new Error('invalid_access_token');
        error.name = 'IdentityError';
        error.code = 'invalid_access_token';
        error.status = 401;
        throw error;
      }
      return { principal: { userId: USER_ID } };
    },
  };
  const identityRouter = express.Router();
  const fileRouter = createFileRouter({
    config: { trustedOrigins: [ORIGIN] },
    identityService,
    logger: { error() {} },
    service,
  });
  const server = createApp({
    allowedOrigins: [ORIGIN],
    fileRouter,
    identityRouter,
    nodeEnv: 'test',
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}/api/v1`,
    objectStore,
    repository,
    server,
    service,
  };
}

async function close(server) {
  server.close();
  await once(server, 'close');
}

test('file HTTP boundary requires trusted origin/current auth and returns redacted DTOs', async () => {
  const harness = await createHarness();
  try {
    const body = Buffer.from('http-avatar');
    const requestBody = {
      byteSize: body.length,
      declaredMime: 'image/png',
      originalName: 'avatar.png',
      ownerType: 'user',
      purpose: 'profile_avatar',
      sha256: sha256(body),
    };
    const missingOrigin = await fetch(`${harness.baseUrl}/files/upload-intents`, {
      body: JSON.stringify(requestBody),
      headers: { Authorization: 'Bearer valid-token', 'Content-Type': 'application/json' },
      method: 'POST',
    });
    assert.equal(missingOrigin.status, 403);
    assert.equal((await missingOrigin.json()).code, 'origin_not_allowed');

    const missingAuth = await fetch(`${harness.baseUrl}/files/upload-intents`, {
      body: JSON.stringify(requestBody),
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      method: 'POST',
    });
    assert.equal(missingAuth.status, 401);

    const created = await fetch(`${harness.baseUrl}/files/upload-intents`, {
      body: JSON.stringify(requestBody),
      headers: {
        Authorization: 'Bearer valid-token',
        'Content-Type': 'application/json',
        Origin: ORIGIN,
      },
      method: 'POST',
    });
    assert.equal(created.status, 201);
    const intent = await created.json();
    assert.doesNotMatch(JSON.stringify(intent.file), /storage|sha256|quarantine/i);

    await harness.objectStore.acceptUpload(intent.file.id, body);
    const completed = await fetch(`${harness.baseUrl}/files/${intent.file.id}/complete`, {
      headers: { Authorization: 'Bearer valid-token', Origin: ORIGIN },
      method: 'POST',
    });
    assert.equal(completed.status, 200);
    assert.equal((await completed.json()).file.scanStatus, 'pending');

    await harness.service.applyTrustedScanResult({
      byteSize: body.length,
      detectedMime: 'image/png',
      fileId: intent.file.id,
      scanStatus: FILE_SCAN_STATUS.CLEAN,
      sha256: sha256(body),
    });
    const download = await fetch(`${harness.baseUrl}/files/${intent.file.id}/download`, {
      headers: { Authorization: 'Bearer valid-token', Origin: ORIGIN },
      method: 'POST',
    });
    assert.equal(download.status, 200);
    const downloadBody = await download.json();
    assert.equal(downloadBody.download.method, 'GET');
    assert.match(downloadBody.download.url, /^https:\/\/objects\.invalid\//);

    const removed = await fetch(`${harness.baseUrl}/files/${intent.file.id}`, {
      headers: { Authorization: 'Bearer valid-token', Origin: ORIGIN },
      method: 'DELETE',
    });
    assert.equal(removed.status, 204);
  } finally {
    await close(harness.server);
  }
});

test('unconfigured file API and production local uploads fail closed', async () => {
  const identityRouter = express.Router();
  const app = createApp({ identityRouter, localUploadServing: false, nodeEnv: 'production' });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const files = await fetch(`${baseUrl}/api/v1/files/example`);
    assert.equal(files.status, 503);
    assert.equal((await files.json()).code, 'file_storage_not_configured');
    const uploads = await fetch(`${baseUrl}/uploads/example.png`);
    assert.equal(uploads.status, 410);
    assert.equal((await uploads.json()).code, 'legacy_local_upload_retired');
  } finally {
    await close(server);
  }
  assert.throws(
    () => createApp({ localUploadServing: true, nodeEnv: 'production' }),
    /cannot be enabled in production/,
  );
});

test('legacy disk upload handlers are retired and create no directories at import', () => {
  const userSource = readFileSync(path.join(__dirname, '..', 'routes', 'user.js'), 'utf8');
  const spaceSource = readFileSync(path.join(__dirname, '..', 'routes', 'space.js'), 'utf8');
  assert.match(userSource, /legacy_user_api_retired/);
  assert.doesNotMatch(userSource, /multer|upload-picture|notes\/:noteId\/upload/);
  assert.match(
    spaceSource,
    /retiredSpaceRoute/,
  );
  assert.doesNotMatch(userSource, /mkdirSync|existsSync/);
  assert.doesNotMatch(spaceSource, /mkdirSync|existsSync/);
});
