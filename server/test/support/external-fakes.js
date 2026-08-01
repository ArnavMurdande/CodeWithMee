'use strict';

const { createHash } = require('node:crypto');

function copy(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function createScriptedMethod(name, script = []) {
  const calls = [];
  let cursor = 0;
  return Object.freeze({
    calls,
    async invoke(input) {
      calls.push(copy(input));
      if (cursor >= script.length) throw new Error(`${name} fake has no scripted result.`);
      const step = script[cursor++];
      if (step instanceof Error) throw step;
      if (step?.error) {
        const error = new Error(step.error.message || `${name} fake failed.`);
        error.code = step.error.code || 'fake_failure';
        throw error;
      }
      return copy(step?.result ?? step);
    },
  });
}

function createAiFake({ script = [] } = {}) {
  const method = createScriptedMethod('AI', script);
  return Object.freeze({ calls: method.calls, generate: (request) => method.invoke(request) });
}

function createVideoFake({ script = [] } = {}) {
  const method = createScriptedMethod('Video', script);
  return Object.freeze({ calls: method.calls, search: (request) => method.invoke(request) });
}

function createRunnerFake({ script = [] } = {}) {
  const method = createScriptedMethod('Runner', script);
  return Object.freeze({ calls: method.calls, execute: (request) => method.invoke(request) });
}

function createEmailFake() {
  const messages = [];
  return Object.freeze({
    messages,
    async send(message) {
      messages.push(copy(message));
      return Object.freeze({
        delivered: true,
        providerMessageId: `test-email-${String(messages.length).padStart(4, '0')}`,
      });
    },
  });
}

function createStorageFake({ clock = () => new Date('2026-08-01T00:00:00.000Z') } = {}) {
  const intents = new Map();
  const objects = new Map();
  return Object.freeze({
    basePrefix: 'test',
    bucket: 'test-private-bucket',
    provider: 'test-memory',
    async acceptUpload(fileId, body) {
      const record = intents.get(fileId);
      if (!record) throw new Error('Storage fake has no upload intent.');
      const bytes = Buffer.isBuffer(body) ? Buffer.from(body) : Buffer.from(body);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      if (bytes.length !== record.byteSize || sha256 !== record.sha256) {
        throw new Error('Storage fake upload did not match declared size and checksum.');
      }
      objects.set(record.storageKey, { bytes, record: copy(record) });
    },
    async close() {},
    async createDownloadUrl(record) {
      if (!objects.has(record.storageKey)) throw new Error('Storage fake object is absent.');
      return Object.freeze({
        expiresAt: new Date(clock().getTime() + 60_000),
        method: 'GET',
        url: `https://storage.invalid/download/${encodeURIComponent(record.id)}`,
      });
    },
    async createUploadUrl(record) {
      intents.set(record.id, copy(record));
      return Object.freeze({
        expiresAt: new Date(clock().getTime() + 300_000),
        method: 'PUT',
        requiredHeaders: Object.freeze({
          'content-length': String(record.byteSize),
          'content-type': record.declaredMime,
        }),
        url: `https://storage.invalid/upload/${encodeURIComponent(record.id)}`,
      });
    },
    async deleteObject(record) {
      objects.delete(record.storageKey);
      intents.delete(record.id);
    },
    async headObject(record) {
      const object = objects.get(record.storageKey);
      if (!object) return null;
      return Object.freeze({
        byteSize: object.bytes.length,
        contentType: object.record.declaredMime,
        metadata: Object.freeze({ 'file-id': object.record.id, sha256: object.record.sha256 }),
      });
    },
    async listObjects() {
      return Object.freeze(
        [...objects.values()]
          .map(({ bytes, record }) =>
            Object.freeze({ byteSize: bytes.length, key: record.storageKey }),
          )
          .sort((left, right) => left.key.localeCompare(right.key)),
      );
    },
  });
}

module.exports = {
  createAiFake,
  createEmailFake,
  createRunnerFake,
  createStorageFake,
  createVideoFake,
};
