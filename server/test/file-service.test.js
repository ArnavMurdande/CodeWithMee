'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const test = require('node:test');

const {
  FILE_SCAN_STATUS,
  FILE_STATE,
  FILE_VISIBILITY,
  validateUploadIntent,
} = require('../modules/files/contracts');
const { createMemoryFileRepository } = require('../modules/files/memory-repository');
const { createMemoryObjectStore } = require('../modules/files/object-store');
const { createFileService } = require('../modules/files/service');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222';
const ORGANIZATION_ID = '33333333-3333-4333-8333-333333333333';

function authentication(userId = USER_ID) {
  return Object.freeze({ principal: Object.freeze({ userId }) });
}

function hash(body) {
  return createHash('sha256').update(body).digest('hex');
}

function expectFileCode(code) {
  return (error) => error?.code === code;
}

function createHarness({ authorizeOrganization } = {}) {
  let currentTime = new Date('2026-08-01T10:00:00.000Z');
  let idCounter = 0;
  const clock = () => new Date(currentTime);
  const repository = createMemoryFileRepository();
  const objectStore = createMemoryObjectStore({ clock });
  const service = createFileService({
    authorizeOrganization,
    clock,
    idFactory: () => {
      idCounter += 1;
      return `00000000-0000-4000-8000-${String(idCounter).padStart(12, '0')}`;
    },
    objectStore,
    repository,
  });
  return {
    advance(milliseconds) {
      currentTime = new Date(currentTime.getTime() + milliseconds);
    },
    clock,
    objectStore,
    repository,
    service,
  };
}

function avatarIntent(body = Buffer.from('fixture-avatar')) {
  return {
    body,
    input: {
      byteSize: body.length,
      declaredMime: 'image/png',
      originalName: 'avatar.png',
      ownerType: 'user',
      purpose: 'profile_avatar',
      sha256: hash(body),
    },
  };
}

test('purpose contracts reject unsafe names, MIME disguises, video, oversize, and invalid checksums', () => {
  const valid = avatarIntent().input;
  assert.deepEqual(validateUploadIntent(valid), valid);
  assert.throws(
    () => validateUploadIntent({ ...valid, originalName: '../avatar.png' }),
    expectFileCode('invalid_original_name'),
  );
  assert.throws(
    () => validateUploadIntent({ ...valid, originalName: 'avatar.exe' }),
    expectFileCode('file_extension_mismatch'),
  );
  assert.throws(
    () => validateUploadIntent({ ...valid, declaredMime: 'video/mp4', originalName: 'x.mp4' }),
    expectFileCode('file_type_not_allowed'),
  );
  assert.throws(
    () => validateUploadIntent({ ...valid, byteSize: 6 * 1024 * 1024 }),
    expectFileCode('file_size_not_allowed'),
  );
  assert.throws(
    () => validateUploadIntent({ ...valid, sha256: 'A'.repeat(64) }),
    expectFileCode('invalid_sha256'),
  );
});

test('owner upload stays private and unreadable until object verification and a clean scan', async () => {
  const harness = createHarness();
  const { body, input } = avatarIntent();
  const intent = await harness.service.createUploadIntent(authentication(), input);

  assert.equal(intent.file.state, FILE_STATE.UPLOAD_PENDING);
  assert.equal(intent.file.visibility, FILE_VISIBILITY.PRIVATE);
  assert.equal(intent.upload.method, 'PUT');
  assert.equal(intent.upload.requiredHeaders['content-length'], String(body.length));
  assert.equal(intent.upload.requiredHeaders['content-type'], 'image/png');
  assert.equal(intent.upload.requiredHeaders['x-amz-meta-file-id'], intent.file.id);
  assert.doesNotMatch(JSON.stringify(intent.file), /storageKey|storageBucket|sha256|quarantine/i);

  await assert.rejects(
    () => harness.service.getMetadata(authentication(OTHER_USER_ID), intent.file.id),
    expectFileCode('file_not_found'),
  );
  await assert.rejects(
    () => harness.service.completeUpload(authentication(), intent.file.id),
    expectFileCode('file_upload_incomplete'),
  );
  await harness.objectStore.acceptUpload(intent.file.id, body);
  const completed = await harness.service.completeUpload(authentication(), intent.file.id);
  assert.equal(completed.uploadedAt, harness.clock().toISOString());
  assert.equal(completed.scanStatus, FILE_SCAN_STATUS.PENDING);
  const completedAgain = await harness.service.completeUpload(authentication(), intent.file.id);
  assert.deepEqual(completedAgain, completed);
  await assert.rejects(
    () => harness.service.createDownload(authentication(), intent.file.id),
    expectFileCode('file_not_ready'),
  );

  const scanned = await harness.service.applyTrustedScanResult({
    byteSize: body.length,
    detectedMime: 'image/png',
    fileId: intent.file.id,
    scanStatus: FILE_SCAN_STATUS.CLEAN,
    sha256: hash(body),
  });
  assert.equal(scanned.state, FILE_STATE.READY);
  assert.equal(scanned.scanStatus, FILE_SCAN_STATUS.CLEAN);
  assert.deepEqual(
    await harness.service.applyTrustedScanResult({
      byteSize: body.length,
      detectedMime: 'image/png',
      fileId: intent.file.id,
      scanStatus: FILE_SCAN_STATUS.INFECTED,
      sha256: hash(body),
    }),
    scanned,
  );
  const download = await harness.service.createDownload(authentication(), intent.file.id);
  assert.equal(download.method, 'GET');
  assert.match(download.url, /^https:\/\/objects\.invalid\/download\//);

  const visible = await harness.service.setVisibility(
    authentication(),
    intent.file.id,
    FILE_VISIBILITY.PUBLIC,
  );
  assert.equal(visible.visibility, FILE_VISIBILITY.PUBLIC);
  await harness.service.deleteFile(authentication(), intent.file.id);
  assert.equal(
    await harness.objectStore.hasObject(await harness.repository.getById(intent.file.id)),
    false,
  );
  await assert.rejects(
    () => harness.service.getMetadata(authentication(), intent.file.id),
    expectFileCode('file_not_found'),
  );

  const events = await harness.repository.events();
  assert.deepEqual(
    events.map((event) => event.eventType),
    [
      'file.scan.requested',
      'file.ready',
      'file.visibility.changed',
      'file.object.delete_requested',
    ],
  );
});

test('metadata mismatch and infected content are quarantined without a download URL', async () => {
  const harness = createHarness();
  const first = avatarIntent(Buffer.from('first-object'));
  const firstIntent = await harness.service.createUploadIntent(authentication(), first.input);
  const firstRecord = await harness.repository.getById(firstIntent.file.id);
  await harness.objectStore.putUncheckedForTest(firstRecord, first.body, { fileId: 'wrong-file' });
  await assert.rejects(
    () => harness.service.completeUpload(authentication(), firstIntent.file.id),
    expectFileCode('file_upload_verification_failed'),
  );
  const rejected = await harness.repository.getById(firstIntent.file.id);
  assert.equal(rejected.state, FILE_STATE.QUARANTINED);
  assert.equal(rejected.scanStatus, FILE_SCAN_STATUS.FAILED);
  assert.equal(rejected.quarantineReason, 'upload_metadata_mismatch');

  const second = avatarIntent(Buffer.from('second-object'));
  const secondIntent = await harness.service.createUploadIntent(authentication(), second.input);
  await harness.objectStore.acceptUpload(secondIntent.file.id, second.body);
  await harness.service.completeUpload(authentication(), secondIntent.file.id);
  const infected = await harness.service.applyTrustedScanResult({
    byteSize: second.body.length,
    detectedMime: 'image/png',
    fileId: secondIntent.file.id,
    scanStatus: FILE_SCAN_STATUS.INFECTED,
    sha256: hash(second.body),
  });
  assert.equal(infected.state, FILE_STATE.QUARANTINED);
  await assert.rejects(
    () => harness.service.createDownload(authentication(), secondIntent.file.id),
    expectFileCode('file_not_ready'),
  );
});

test('organization ownership is explicit and cannot be inferred or elevated', async () => {
  const decisions = [];
  const harness = createHarness({
    async authorizeOrganization(input) {
      decisions.push(input);
      return input.principal.userId === USER_ID && input.organizationId === ORGANIZATION_ID;
    },
  });
  const body = Buffer.from('organization-logo');
  const intent = await harness.service.createUploadIntent(authentication(), {
    byteSize: body.length,
    declaredMime: 'image/png',
    originalName: 'logo.png',
    ownerOrganizationId: ORGANIZATION_ID,
    ownerType: 'organization',
    purpose: 'organization_logo',
    sha256: hash(body),
  });
  const record = await harness.repository.getById(intent.file.id);
  assert.equal(record.ownerOrganizationId, ORGANIZATION_ID);
  assert.equal(record.ownerUserId, null);
  assert.equal(decisions[0].action, 'write');

  await assert.rejects(
    () =>
      harness.service.createUploadIntent(authentication(OTHER_USER_ID), {
        byteSize: body.length,
        declaredMime: 'image/png',
        originalName: 'logo.png',
        ownerOrganizationId: ORGANIZATION_ID,
        ownerType: 'organization',
        purpose: 'organization_logo',
        sha256: hash(body),
      }),
    expectFileCode('organization_file_access_denied'),
  );
  await assert.rejects(
    () =>
      harness.service.createUploadIntent(authentication(), {
        ...avatarIntent().input,
        ownerType: 'organization',
        ownerOrganizationId: ORGANIZATION_ID,
      }),
    expectFileCode('file_owner_type_not_allowed'),
  );
});

test('cleanup revokes stale pending and quarantined files before deleting objects', async () => {
  const harness = createHarness();
  const pending = avatarIntent(Buffer.from('pending'));
  const pendingIntent = await harness.service.createUploadIntent(authentication(), pending.input);

  const bad = avatarIntent(Buffer.from('bad'));
  const badIntent = await harness.service.createUploadIntent(authentication(), bad.input);
  await harness.objectStore.acceptUpload(badIntent.file.id, bad.body);
  await harness.service.completeUpload(authentication(), badIntent.file.id);
  await harness.service.applyTrustedScanResult({
    byteSize: bad.body.length,
    detectedMime: 'image/png',
    fileId: badIntent.file.id,
    scanStatus: FILE_SCAN_STATUS.UNSCANNABLE,
    sha256: hash(bad.body),
  });

  harness.advance(8 * 24 * 60 * 60 * 1000);
  const result = await harness.service.cleanupExpired({
    pendingBefore: new Date(harness.clock().getTime() - 24 * 60 * 60 * 1000),
    quarantineBefore: new Date(harness.clock().getTime() - 7 * 24 * 60 * 60 * 1000),
  });
  assert.deepEqual(result, { candidates: 2, deleted: 2, objectDeleteFailures: 0 });
  assert.equal((await harness.repository.getById(pendingIntent.file.id)).state, FILE_STATE.DELETED);
  assert.equal((await harness.repository.getById(badIntent.file.id)).state, FILE_STATE.DELETED);
});
