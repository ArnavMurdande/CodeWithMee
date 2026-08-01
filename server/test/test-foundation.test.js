'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createAiFake,
  createEmailFake,
  createRunnerFake,
  createStorageFake,
  createVideoFake,
} = require('./support/external-fakes');
const {
  createFileRecordFactory,
  createSequence,
  createTestClock,
  createUserFactory,
} = require('./support/factories');

test('deterministic clocks, sequences, and domain factories are repeatable', () => {
  const clock = createTestClock();
  const next = createSequence('operation');
  const user = createUserFactory()({ displayName: 'Ada Example' });

  assert.equal(clock.now().toISOString(), '2026-08-01T00:00:00.000Z');
  assert.equal(clock.advance(1_000).toISOString(), '2026-08-01T00:00:01.000Z');
  assert.deepEqual([next(), next()], ['operation-0001', 'operation-0002']);
  assert.equal(user.id, 'user-0001');
  assert.equal(user.email, 'user-0001@example.invalid');
  assert.equal(user.displayName, 'Ada Example');
});

test('AI, video, and runner fakes return scripted results and capture redacted inputs', async () => {
  const ai = createAiFake({ script: [{ result: { text: 'bounded explanation' } }] });
  const video = createVideoFake({ script: [{ result: { videoId: 'video-test-001' } }] });
  const runner = createRunnerFake({
    script: [{ result: { exitCode: 0, stderr: '', stdout: 'ok\n' } }],
  });

  assert.deepEqual(await ai.generate({ model: 'test-model', prompt: 'explain loops' }), {
    text: 'bounded explanation',
  });
  assert.deepEqual(await video.search({ query: 'loops tutorial' }), {
    videoId: 'video-test-001',
  });
  assert.deepEqual(await runner.execute({ code: 'print("ok")', language: 'python' }), {
    exitCode: 0,
    stderr: '',
    stdout: 'ok\n',
  });
  assert.equal(ai.calls.length, 1);
  assert.equal(video.calls.length, 1);
  assert.equal(runner.calls.length, 1);
});

test('scripted external fakes fail closed when an outcome was not configured', async () => {
  const ai = createAiFake();
  await assert.rejects(ai.generate({ prompt: 'must not leave the process' }), {
    message: 'AI fake has no scripted result.',
  });
});

test('email fake captures delivery without a provider or secret', async () => {
  const email = createEmailFake();
  const result = await email.send({ purpose: 'verification', to: 'user@example.invalid' });

  assert.deepEqual(result, { delivered: true, providerMessageId: 'test-email-0001' });
  assert.deepEqual(email.messages, [{ purpose: 'verification', to: 'user@example.invalid' }]);
});

test('private storage fake enforces intent size/checksum and deterministic URLs', async () => {
  const storage = createStorageFake();
  const { body, record } = createFileRecordFactory()('hello storage');
  const upload = await storage.createUploadUrl(record);

  assert.equal(upload.url, 'https://storage.invalid/upload/file-0001');
  await storage.acceptUpload(record.id, body);
  assert.equal((await storage.headObject(record)).metadata.sha256, record.sha256);
  assert.deepEqual(await storage.listObjects(), [{ byteSize: body.length, key: 'test/file-0001' }]);
  assert.equal(
    (await storage.createDownloadUrl(record)).url,
    'https://storage.invalid/download/file-0001',
  );
});
