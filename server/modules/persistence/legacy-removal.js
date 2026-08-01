'use strict';

const { createHash, createHmac } = require('node:crypto');

const { PERSISTENCE_DOMAIN, PERSISTENCE_STORE } = require('./contracts');

const PLAN_FORMAT = 'codewithmee.legacy-removal-plan.v1';
const PERSISTENCE_DOMAINS = Object.freeze(Object.values(PERSISTENCE_DOMAIN).sort());

function blocker(code, detail) {
  return Object.freeze({ code, detail });
}

function evaluateLegacyRemovalReadiness({
  backup = {},
  clock = () => new Date(),
  legalHoldCleared = false,
  localUploadServingRetired = false,
  parity = {},
  persistence = {},
  reconciliation = {},
  rollbackUntil,
} = {}) {
  const blockers = [];
  const stores = persistence.stores || {};
  const nonPostgres = PERSISTENCE_DOMAINS.filter(
    (domain) => stores[domain] !== PERSISTENCE_STORE.POSTGRES,
  );
  if (nonPostgres.length) {
    blockers.push(
      blocker('domains_not_postgres', `${nonPostgres.length} domain(s) remain legacy.`),
    );
  }
  if (persistence.legacyApiMode !== 'disabled') {
    blockers.push(
      blocker('legacy_api_enabled', 'The legacy API must return its retirement response.'),
    );
  }
  if (!localUploadServingRetired) {
    blockers.push(
      blocker('local_upload_serving_enabled', 'Local upload serving must remain retired.'),
    );
  }
  if (!backup.archiveAuthenticated) {
    blockers.push(blocker('backup_not_authenticated', 'An authenticated backup is required.'));
  }
  if (!backup.restoreVerified || backup.sourceDatabase === backup.restoreDatabase) {
    blockers.push(
      blocker('independent_restore_unverified', 'Restore must pass in a distinct target.'),
    );
  }
  if (!backup.contentSha256 || backup.contentSha256 !== backup.restoredContentSha256) {
    blockers.push(
      blocker('restore_content_mismatch', 'Restored content digest must match the backup.'),
    );
  }
  const unreadyDomains = PERSISTENCE_DOMAINS.filter(
    (domain) => parity.domains?.[domain]?.readyForCutover !== true,
  );
  if (unreadyDomains.length) {
    blockers.push(blocker('parity_incomplete', `${unreadyDomains.length} domain(s) lack parity.`));
  }
  if (reconciliation.readyForLegacyRetirement !== true) {
    blockers.push(
      blocker('file_reconciliation_blocked', 'Database, object, or legacy files differ.'),
    );
  }
  const deadline = new Date(rollbackUntil || '');
  if (!Number.isFinite(deadline.getTime()) || deadline.getTime() > clock().getTime()) {
    blockers.push(
      blocker('rollback_retention_active', 'The authenticated rollback window has not expired.'),
    );
  }
  if (!legalHoldCleared) {
    blockers.push(
      blocker('legal_hold_not_cleared', 'Retention and legal-hold approval is required.'),
    );
  }

  blockers.sort((left, right) => left.code.localeCompare(right.code));
  return Object.freeze({
    blockers: Object.freeze(blockers),
    format: PLAN_FORMAT,
    readyForRemoval: blockers.length === 0,
    removalIsAutomatic: false,
    requiredApproval:
      'A separately reviewed destructive change must name the exact Mongo database, object prefix and local-upload root.',
  });
}

function signLegacyRemovalPlan(plan, key) {
  if (!key || key.length !== 32) throw new Error('A 32-byte removal-plan key is required.');
  const json = JSON.stringify(plan);
  return Object.freeze({
    algorithm: 'HMAC-SHA-256',
    format: PLAN_FORMAT,
    plan,
    planSha256: createHash('sha256').update(json).digest('hex'),
    signature: createHmac('sha256', key).update(json).digest('hex'),
  });
}

module.exports = { PLAN_FORMAT, evaluateLegacyRemovalReadiness, signLegacyRemovalPlan };
