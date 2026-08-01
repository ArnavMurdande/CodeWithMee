'use strict';

const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const test = require('node:test');

const { PERSISTENCE_DOMAIN } = require('../modules/persistence/contracts');
const {
  evaluateLegacyRemovalReadiness,
  signLegacyRemovalPlan,
} = require('../modules/persistence/legacy-removal');

const domains = Object.values(PERSISTENCE_DOMAIN);

test('legacy removal remains blocked while any safety proof or domain is incomplete', () => {
  const plan = evaluateLegacyRemovalReadiness({
    clock: () => new Date('2026-08-01T00:00:00.000Z'),
    persistence: {
      legacyApiMode: 'enabled',
      stores: Object.fromEntries(domains.map((domain) => [domain, 'mongoose'])),
    },
    rollbackUntil: '2026-08-02T00:00:00.000Z',
  });
  assert.equal(plan.readyForRemoval, false);
  assert.equal(plan.removalIsAutomatic, false);
  assert.ok(plan.blockers.some((current) => current.code === 'domains_not_postgres'));
  assert.ok(plan.blockers.some((current) => current.code === 'backup_not_authenticated'));
  assert.ok(plan.blockers.some((current) => current.code === 'file_reconciliation_blocked'));
});

test('legacy removal readiness still requires a separate exact destructive change', () => {
  const contentSha256 = 'a'.repeat(64);
  const plan = evaluateLegacyRemovalReadiness({
    backup: {
      archiveAuthenticated: true,
      contentSha256,
      restoreDatabase: 'codewithmee_restore',
      restoredContentSha256: contentSha256,
      restoreVerified: true,
      sourceDatabase: 'codewithmee_source',
    },
    clock: () => new Date('2026-08-02T00:00:00.000Z'),
    legalHoldCleared: true,
    localUploadServingRetired: true,
    parity: {
      domains: Object.fromEntries(domains.map((domain) => [domain, { readyForCutover: true }])),
    },
    persistence: {
      legacyApiMode: 'disabled',
      stores: Object.fromEntries(domains.map((domain) => [domain, 'postgres'])),
    },
    reconciliation: { readyForLegacyRetirement: true },
    rollbackUntil: '2026-08-01T00:00:00.000Z',
  });
  assert.equal(plan.readyForRemoval, true);
  assert.equal(plan.removalIsAutomatic, false);
  const signed = signLegacyRemovalPlan(plan, randomBytes(32));
  assert.match(signed.planSha256, /^[0-9a-f]{64}$/);
  assert.match(signed.signature, /^[0-9a-f]{64}$/);
});
