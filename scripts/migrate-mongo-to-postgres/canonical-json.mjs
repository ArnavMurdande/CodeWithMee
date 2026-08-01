import { createHash, createHmac } from 'node:crypto';

/** @param {any} value */
function isObjectId(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    (value._bsontype === 'ObjectId' || value._bsontype === 'ObjectID') &&
    typeof value.toHexString === 'function',
  );
}

/** @param {any} value */
function isDecimal128(value) {
  return Boolean(value && typeof value === 'object' && value._bsontype === 'Decimal128');
}

/**
 * Normalize BSON-compatible data to a deterministic JSON-compatible shape.
 * The explicit dynamic boundary is intentional because legacy Mongo documents
 * are schemaless and are validated by the planner before any target write.
 *
 * @param {any} value
 * @returns {any}
 */
export function canonicalize(value) {
  if (value === null || ['boolean', 'number', 'string'].includes(typeof value)) return value;
  if (typeof value === 'bigint') return { $numberLong: value.toString() };
  if (value instanceof Date) return { $date: value.toISOString() };
  if (Buffer.isBuffer(value)) return { $binary: value.toString('base64') };
  if (isObjectId(value)) return { $oid: value.toHexString().toLowerCase() };
  if (isDecimal128(value)) return { $numberDecimal: value.toString() };
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort((left, right) => left.localeCompare(right))
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  throw new TypeError(`Unsupported canonical JSON value: ${typeof value}`);
}

/** @param {any} value */
export function stableStringify(value) {
  return JSON.stringify(canonicalize(value));
}

/** @param {string | Buffer} value */
export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * @param {unknown} value
 * @param {Buffer} key
 */
export function fingerprint(value, key) {
  return createHmac('sha256', key).update(String(value)).digest('hex');
}

/** @param {any} value */
export function sourceIdentifier(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }
  if (isObjectId(value)) return value.toHexString().toLowerCase();
  if (typeof value === 'object' && typeof value.$oid === 'string') return value.$oid.toLowerCase();
  if (typeof value === 'object' && typeof value.$numberLong === 'string') return value.$numberLong;
  return stableStringify(value);
}

/** @param {string} uuid */
function parseUuid(uuid) {
  const compact = uuid.replaceAll('-', '');
  if (!/^[0-9a-f]{32}$/i.test(compact)) throw new Error('Invalid UUID namespace');
  return Buffer.from(compact, 'hex');
}

/**
 * @param {string} namespace
 * @param {string} name
 */
export function uuidV5(namespace, name) {
  const digest = createHash('sha1')
    .update(parseUuid(namespace))
    .update(String(name))
    .digest()
    .subarray(0, 16);
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = digest.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
