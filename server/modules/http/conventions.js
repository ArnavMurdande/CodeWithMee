'use strict';

const { createHmac, timingSafeEqual } = require('node:crypto');

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/;
const REVISION_ETAG_PATTERN = /^"rev-([1-9][0-9]{0,14})"$/;

function parseIdempotencyKey(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
    const error = new Error('Invalid Idempotency-Key header.');
    error.code = 'invalid_idempotency_key';
    error.status = 400;
    throw error;
  }
  return value;
}

function revisionEtag(revision) {
  if (!Number.isSafeInteger(revision) || revision < 1)
    throw new Error('Revision must be positive.');
  return `"rev-${revision}"`;
}

function parseRevisionEtag(value, { required = true } = {}) {
  if ((value == null || value === '') && !required) return null;
  const match = REVISION_ETAG_PATTERN.exec(String(value || ''));
  if (!match) {
    const error = new Error('A valid If-Match revision is required.');
    error.code = 'revision_precondition_required';
    error.status = 428;
    throw error;
  }
  return Number(match[1]);
}

function cursorSignature(encodedPayload, secret) {
  return createHmac('sha256', secret).update(encodedPayload).digest('base64url');
}

function encodeCursor(payload, secret) {
  if (!Buffer.isBuffer(secret) || secret.length < 32) {
    throw new Error('Cursor signing secret must contain at least 32 bytes.');
  }
  const normalized = {
    id: String(payload.id || ''),
    sort: String(payload.sort || ''),
    v: 1,
  };
  if (
    !normalized.id ||
    normalized.id.length > 200 ||
    !normalized.sort ||
    normalized.sort.length > 200
  ) {
    throw new Error('Cursor payload is invalid.');
  }
  const encoded = Buffer.from(JSON.stringify(normalized)).toString('base64url');
  return `${encoded}.${cursorSignature(encoded, secret)}`;
}

function decodeCursor(value, secret) {
  if (!Buffer.isBuffer(secret) || secret.length < 32) {
    throw new Error('Cursor signing secret must contain at least 32 bytes.');
  }
  if (typeof value !== 'string' || value.length > 1024) return null;
  const [encoded, signature, ...extra] = value.split('.');
  if (!encoded || !signature || extra.length) return null;
  const expected = Buffer.from(cursorSignature(encoded, secret));
  const supplied = Buffer.from(signature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (
      payload?.v !== 1 ||
      typeof payload.id !== 'string' ||
      !payload.id ||
      payload.id.length > 200 ||
      typeof payload.sort !== 'string' ||
      !payload.sort ||
      payload.sort.length > 200 ||
      Object.keys(payload).some((key) => !['id', 'sort', 'v'].includes(key))
    ) {
      return null;
    }
    return Object.freeze(payload);
  } catch {
    return null;
  }
}

module.exports = {
  IDEMPOTENCY_KEY_PATTERN,
  REVISION_ETAG_PATTERN,
  decodeCursor,
  encodeCursor,
  parseIdempotencyKey,
  parseRevisionEtag,
  revisionEtag,
};
