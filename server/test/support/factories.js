'use strict';

const { createHash } = require('node:crypto');

function createTestClock(initial = '2026-08-01T00:00:00.000Z') {
  let current = new Date(initial);
  if (Number.isNaN(current.getTime())) throw new Error('Test clock requires a valid date.');
  return Object.freeze({
    advance(milliseconds) {
      if (!Number.isFinite(milliseconds)) throw new Error('Clock advance must be finite.');
      current = new Date(current.getTime() + milliseconds);
      return new Date(current);
    },
    now: () => new Date(current),
  });
}

function createSequence(prefix = 'test') {
  let value = 0;
  return () => `${prefix}-${String(++value).padStart(4, '0')}`;
}

function createUserFactory() {
  const nextId = createSequence('user');
  return (overrides = {}) => {
    const id = overrides.id || nextId();
    return Object.freeze({
      displayName: `Test User ${id}`,
      email: `${id}@example.invalid`,
      emailVerifiedAt: new Date('2026-08-01T00:00:00.000Z'),
      id,
      platformRole: 'user',
      status: 'active',
      ...structuredClone(overrides),
    });
  };
}

function createFileRecordFactory() {
  const nextId = createSequence('file');
  return (body = 'test file', overrides = {}) => {
    const bytes = Buffer.isBuffer(body) ? Buffer.from(body) : Buffer.from(String(body));
    const id = overrides.id || nextId();
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    return Object.freeze({
      body: bytes,
      record: Object.freeze({
        byteSize: bytes.length,
        declaredMime: 'text/plain',
        detectedMime: 'text/plain',
        id,
        originalName: `${id}.txt`,
        sha256,
        storageKey: `test/${id}`,
        ...structuredClone(overrides),
      }),
    });
  };
}

module.exports = { createFileRecordFactory, createSequence, createTestClock, createUserFactory };
