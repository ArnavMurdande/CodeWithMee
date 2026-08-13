'use strict';

const path = require('node:path');

const { FileError } = require('./errors');

const FILE_STATE = Object.freeze({
  DELETED: 'deleted',
  QUARANTINED: 'quarantined',
  READY: 'ready',
  UPLOAD_PENDING: 'upload_pending',
});

const FILE_SCAN_STATUS = Object.freeze({
  CLEAN: 'clean',
  FAILED: 'failed',
  INFECTED: 'infected',
  PENDING: 'pending',
  UNSCANNABLE: 'unscannable',
});

const FILE_VISIBILITY = Object.freeze({
  ENROLLED: 'enrolled',
  ORGANIZATION: 'organization',
  PRIVATE: 'private',
  PUBLIC: 'public',
});

const FILE_OWNER_TYPE = Object.freeze({
  ORGANIZATION: 'organization',
  USER: 'user',
});

const MIME_EXTENSIONS = Object.freeze({
  'application/json': ['.json'],
  'application/pdf': ['.pdf'],
  'application/zip': ['.zip'],
  'audio/mpeg': ['.mp3'],
  'audio/ogg': ['.ogg'],
  'audio/wav': ['.wav'],
  'audio/webm': ['.webm'],
  'image/gif': ['.gif'],
  'image/jpeg': ['.jpeg', '.jpg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'text/markdown': ['.md'],
  'text/plain': ['.txt'],
  'video/mp4': ['.mp4'],
  'video/webm': ['.webm'],
});

function policy({ maxBytes, mimes, ownerTypes, publicAllowed = false, enrolledAllowed = false }) {
  return Object.freeze({
    allowedMimes: Object.freeze([...mimes]),
    allowedOwnerTypes: Object.freeze([...ownerTypes]),
    allowedVisibilities: Object.freeze([
      FILE_VISIBILITY.PRIVATE,
      ...(enrolledAllowed ? [FILE_VISIBILITY.ENROLLED] : []),
      ...(publicAllowed ? [FILE_VISIBILITY.PUBLIC] : []),
    ]),
    maxBytes,
  });
}

const IMAGE_MIMES = Object.freeze(['image/gif', 'image/jpeg', 'image/png', 'image/webp']);
const DOCUMENT_MIMES = Object.freeze([
  'application/json',
  'application/pdf',
  'application/zip',
  'text/markdown',
  'text/plain',
]);

const FILE_PURPOSE_POLICY = Object.freeze({
  payment_qr: policy({
    maxBytes: 5 * 1024 * 1024,
    mimes: IMAGE_MIMES,
    ownerTypes: [FILE_OWNER_TYPE.ORGANIZATION],
  }),
  payment_proof: policy({
    maxBytes: 15 * 1024 * 1024,
    mimes: [...IMAGE_MIMES, 'application/pdf'],
    ownerTypes: [FILE_OWNER_TYPE.USER],
  }),
  assignment_submission: policy({
    maxBytes: 100 * 1024 * 1024,
    mimes: DOCUMENT_MIMES,
    ownerTypes: [FILE_OWNER_TYPE.USER],
  }),
  course_resource: policy({
    maxBytes: 100 * 1024 * 1024,
    mimes: [...DOCUMENT_MIMES, ...IMAGE_MIMES],
    ownerTypes: [FILE_OWNER_TYPE.ORGANIZATION],
    enrolledAllowed: true,
  }),
  course_video: policy({
    maxBytes: 100 * 1024 * 1024,
    mimes: ['video/mp4', 'video/webm'],
    ownerTypes: [FILE_OWNER_TYPE.ORGANIZATION],
    enrolledAllowed: true,
  }),
  idea_artifact: policy({
    maxBytes: 100 * 1024 * 1024,
    mimes: [...DOCUMENT_MIMES, ...IMAGE_MIMES],
    ownerTypes: [FILE_OWNER_TYPE.USER, FILE_OWNER_TYPE.ORGANIZATION],
  }),
  note_attachment: policy({
    maxBytes: 25 * 1024 * 1024,
    mimes: [
      ...DOCUMENT_MIMES.filter((mime) => mime !== 'application/zip'),
      ...IMAGE_MIMES,
      'audio/mpeg',
      'audio/ogg',
      'audio/wav',
      'audio/webm',
      'video/mp4',
      'video/webm',
    ],
    ownerTypes: [FILE_OWNER_TYPE.USER],
  }),
  organization_logo: policy({
    maxBytes: 5 * 1024 * 1024,
    mimes: IMAGE_MIMES,
    ownerTypes: [FILE_OWNER_TYPE.ORGANIZATION],
    publicAllowed: true,
  }),
  profile_avatar: policy({
    maxBytes: 5 * 1024 * 1024,
    mimes: IMAGE_MIMES,
    ownerTypes: [FILE_OWNER_TYPE.USER],
    publicAllowed: true,
  }),
  provider_evidence: policy({
    maxBytes: 10 * 1024 * 1024,
    mimes: ['application/pdf', ...IMAGE_MIMES],
    ownerTypes: [FILE_OWNER_TYPE.ORGANIZATION],
  }),
  social_image: policy({
    maxBytes: 10 * 1024 * 1024,
    mimes: IMAGE_MIMES,
    ownerTypes: [FILE_OWNER_TYPE.USER],
    publicAllowed: true,
  }),
  workspace_archive: policy({
    maxBytes: 50 * 1024 * 1024,
    mimes: ['application/zip'],
    ownerTypes: [FILE_OWNER_TYPE.USER],
  }),
});

function normalizeMime(value) {
  if (typeof value !== 'string') throw new FileError('invalid_declared_mime', 400);
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(normalized)) {
    throw new FileError('invalid_declared_mime', 400);
  }
  return normalized;
}

function normalizeSha256(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new FileError('invalid_sha256', 400);
  }
  return value;
}

function checksumBase64(sha256) {
  return Buffer.from(normalizeSha256(sha256), 'hex').toString('base64');
}

function normalizeOriginalName(value) {
  if (typeof value !== 'string') throw new FileError('invalid_original_name', 400);
  const normalized = value.normalize('NFKC').trim();
  const hasControlCharacter = [...normalized].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
  if (
    !normalized ||
    normalized === '.' ||
    normalized === '..' ||
    normalized !== path.basename(normalized) ||
    hasControlCharacter ||
    /[/\\]/.test(normalized) ||
    normalized.length > 255 ||
    Buffer.byteLength(normalized, 'utf8') > 512
  ) {
    throw new FileError('invalid_original_name', 400);
  }
  return normalized;
}

function purposePolicy(purpose) {
  if (typeof purpose !== 'string' || !Object.hasOwn(FILE_PURPOSE_POLICY, purpose)) {
    throw new FileError('unsupported_file_purpose', 400);
  }
  return FILE_PURPOSE_POLICY[purpose];
}

function mimeAllowedForPurpose(purpose, mime) {
  return purposePolicy(purpose).allowedMimes.includes(normalizeMime(mime));
}

function validateUploadIntent(input = {}) {
  const purpose = typeof input.purpose === 'string' ? input.purpose : '';
  const purposeRules = purposePolicy(purpose);
  const ownerType = input.ownerType || FILE_OWNER_TYPE.USER;
  if (!purposeRules.allowedOwnerTypes.includes(ownerType)) {
    throw new FileError('file_owner_type_not_allowed', 400);
  }
  const originalName = normalizeOriginalName(input.originalName);
  const declaredMime = normalizeMime(input.declaredMime);
  if (!purposeRules.allowedMimes.includes(declaredMime)) {
    throw new FileError('file_type_not_allowed', 415);
  }
  const extension = path.extname(originalName).toLowerCase();
  if (!MIME_EXTENSIONS[declaredMime]?.includes(extension)) {
    throw new FileError('file_extension_mismatch', 415);
  }
  const byteSize = Number(input.byteSize);
  if (!Number.isSafeInteger(byteSize) || byteSize <= 0 || byteSize > purposeRules.maxBytes) {
    throw new FileError('file_size_not_allowed', 413, { maxBytes: purposeRules.maxBytes });
  }
  const sha256 = normalizeSha256(input.sha256);
  return Object.freeze({ byteSize, declaredMime, originalName, ownerType, purpose, sha256 });
}

module.exports = {
  FILE_OWNER_TYPE,
  FILE_PURPOSE_POLICY,
  FILE_SCAN_STATUS,
  FILE_STATE,
  FILE_VISIBILITY,
  checksumBase64,
  mimeAllowedForPurpose,
  normalizeMime,
  normalizeOriginalName,
  normalizeSha256,
  purposePolicy,
  validateUploadIntent,
};
