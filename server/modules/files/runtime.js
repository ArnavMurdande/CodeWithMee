'use strict';

function integerSetting(name, value, fallback, minimum, maximum) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function booleanSetting(name, value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false.`);
}

function optionalEndpoint(value, nodeEnv) {
  if (!value?.trim()) return undefined;
  let endpoint;
  try {
    endpoint = new URL(value.trim());
  } catch {
    throw new Error('FILE_STORAGE_ENDPOINT must be an absolute HTTP(S) URL.');
  }
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
    throw new Error('FILE_STORAGE_ENDPOINT must be a credential-free HTTP(S) URL.');
  }
  if (nodeEnv === 'production' && endpoint.protocol !== 'https:') {
    throw new Error('FILE_STORAGE_ENDPOINT must use HTTPS in production.');
  }
  return endpoint.toString().replace(/\/$/, '');
}

function loadFileStorageConfig(environment = process.env, { nodeEnv = 'development' } = {}) {
  const mode = environment.FILE_STORAGE_MODE?.trim() || '';
  if (!mode) return Object.freeze({ enabled: false, reason: 'file_storage_not_configured' });
  if (mode !== 's3') throw new Error('FILE_STORAGE_MODE must be s3 when configured.');

  const bucket = environment.FILE_STORAGE_BUCKET?.trim() || '';
  const region = environment.FILE_STORAGE_REGION?.trim() || '';
  if (
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) ||
    bucket.includes('..') ||
    bucket.includes('.-') ||
    bucket.includes('-.') ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(bucket)
  ) {
    throw new Error('FILE_STORAGE_BUCKET must be a DNS-compatible private bucket name.');
  }
  if (!/^[a-z0-9][a-z0-9-]{0,99}$/i.test(region)) {
    throw new Error(
      'FILE_STORAGE_REGION is required and must contain only letters, digits, or hyphens.',
    );
  }

  const accessKeyId = environment.FILE_STORAGE_ACCESS_KEY_ID?.trim() || '';
  const secretAccessKey = environment.FILE_STORAGE_SECRET_ACCESS_KEY?.trim() || '';
  if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) {
    throw new Error(
      'FILE_STORAGE_ACCESS_KEY_ID and FILE_STORAGE_SECRET_ACCESS_KEY must be set together.',
    );
  }

  const prefix = environment.FILE_STORAGE_PREFIX?.trim() || `codewithmee/${nodeEnv}`;
  if (
    !/^[a-z0-9][a-z0-9/_-]{0,160}$/i.test(prefix) ||
    prefix.includes('..') ||
    prefix.includes('//') ||
    prefix.endsWith('/')
  ) {
    throw new Error('FILE_STORAGE_PREFIX contains an unsafe segment.');
  }

  const scannerMode = environment.FILE_SCANNER_MODE?.trim() || 'disabled';
  if (!['disabled', 'external'].includes(scannerMode)) {
    throw new Error('FILE_SCANNER_MODE must be disabled or external.');
  }
  if (nodeEnv === 'production' && scannerMode !== 'external') {
    throw new Error('FILE_SCANNER_MODE must be external in production.');
  }

  return Object.freeze({
    bucket,
    credentials: accessKeyId ? Object.freeze({ accessKeyId, secretAccessKey }) : undefined,
    downloadTtlSeconds: integerSetting(
      'FILE_DOWNLOAD_TTL_SECONDS',
      environment.FILE_DOWNLOAD_TTL_SECONDS,
      60,
      15,
      300,
    ),
    enabled: true,
    endpoint: optionalEndpoint(environment.FILE_STORAGE_ENDPOINT, nodeEnv),
    forcePathStyle: booleanSetting(
      'FILE_STORAGE_FORCE_PATH_STYLE',
      environment.FILE_STORAGE_FORCE_PATH_STYLE,
    ),
    prefix,
    provider: 's3',
    region,
    scannerMode,
    uploadTtlSeconds: integerSetting(
      'FILE_UPLOAD_TTL_SECONDS',
      environment.FILE_UPLOAD_TTL_SECONDS,
      300,
      60,
      900,
    ),
  });
}

module.exports = { loadFileStorageConfig };
