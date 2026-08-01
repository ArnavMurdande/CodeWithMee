'use strict';

function positiveHours(name, value, fallback, maximum) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}.`);
  }
  return parsed;
}

function assertFileCleanupSafety(environment, storageConfig) {
  if (!environment.DATABASE_URL?.trim())
    throw new Error('DATABASE_URL is required for file cleanup.');
  const expectedApproval = `cleanup:${storageConfig.bucket}`;
  if (environment.FILE_CLEANUP_APPROVAL !== expectedApproval) {
    throw new Error(`FILE_CLEANUP_APPROVAL must equal ${expectedApproval}.`);
  }
  return Object.freeze({
    pendingHours: positiveHours(
      'FILE_PENDING_RETENTION_HOURS',
      environment.FILE_PENDING_RETENTION_HOURS,
      24,
      24 * 30,
    ),
    quarantineHours: positiveHours(
      'FILE_QUARANTINE_RETENTION_HOURS',
      environment.FILE_QUARANTINE_RETENTION_HOURS,
      24 * 7,
      24 * 365,
    ),
  });
}

module.exports = { assertFileCleanupSafety };
