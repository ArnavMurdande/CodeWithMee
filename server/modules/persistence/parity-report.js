'use strict';

const { createHash, createHmac, timingSafeEqual } = require('node:crypto');

const { PERSISTENCE_DOMAIN, POSTGRES_RUNTIME_READY_DOMAINS } = require('./contracts');

const PARITY_FORMAT = 'codewithmee.persistence-parity.v1';

const DOMAIN_COLLECTIONS = Object.freeze({
  [PERSISTENCE_DOMAIN.AUTHORITY]: Object.freeze(['authority_audit_events', 'authority_controls']),
  [PERSISTENCE_DOMAIN.CHALLENGES]: Object.freeze(['challenges']),
  [PERSISTENCE_DOMAIN.COURSES]: Object.freeze(['courses', 'enrollments']),
  [PERSISTENCE_DOMAIN.IDEAS]: Object.freeze(['projects']),
  [PERSISTENCE_DOMAIN.IDENTITY]: Object.freeze([
    'authidentities',
    'authsessions',
    'identityonetimetokens',
    'users',
  ]),
  [PERSISTENCE_DOMAIN.INTEGRATIONS]: Object.freeze(['youtubecaches']),
  [PERSISTENCE_DOMAIN.LEARNING]: Object.freeze(['users']),
  [PERSISTENCE_DOMAIN.ORGANIZATIONS]: Object.freeze([
    'companies',
    'companyemployees',
    'organizationinvitations',
    'organizationmemberships',
    'organizations',
    'providerverificationreviews',
  ]),
  [PERSISTENCE_DOMAIN.SOCIAL]: Object.freeze(['posts', 'users']),
});

const TARGET_TABLES = Object.freeze({
  audit_event: Object.freeze({ column: 'id', table: 'audit_events' }),
  auth_identity: Object.freeze({ column: 'id', table: 'auth_identities' }),
  authority_control: Object.freeze({ column: 'key', table: 'authority_controls' }),
  challenge: Object.freeze({ column: 'id', table: 'challenges' }),
  course: Object.freeze({ column: 'id', table: 'courses' }),
  enrollment: Object.freeze({ column: 'id', table: 'enrollments' }),
  idea: Object.freeze({ column: 'id', table: 'ideas' }),
  integration_cache: Object.freeze({ column: 'id', table: 'integration_cache' }),
  organization: Object.freeze({ column: 'id', table: 'organizations' }),
  organization_claim: Object.freeze({ column: 'id', table: 'organizations' }),
  organization_membership: Object.freeze({ column: 'id', table: 'organization_memberships' }),
  organization_membership_legacy: Object.freeze({
    column: 'id',
    table: 'organization_memberships',
  }),
  post: Object.freeze({ column: 'id', table: 'social_posts' }),
  provider_verification_review: Object.freeze({
    column: 'id',
    table: 'provider_verification_reviews',
  }),
  user: Object.freeze({ column: 'id', table: 'users' }),
});

const TABLE_COUNTS = Object.freeze([
  'audit_events',
  'auth_identities',
  'authority_controls',
  'challenge_test_cases',
  'challenge_versions',
  'challenges',
  'course_versions',
  'courses',
  'enrollments',
  'ideas',
  'integration_cache',
  'learning_profiles',
  'organization_memberships',
  'organizations',
  'provider_verification_reviews',
  'social_posts',
  'users',
]);

const INTEGRITY_CHECKS = Object.freeze([
  Object.freeze({
    code: 'identity_user_without_identity',
    domains: Object.freeze([PERSISTENCE_DOMAIN.IDENTITY]),
    sql: `SELECT COUNT(*)::integer AS count
            FROM users u
           WHERE NOT EXISTS (SELECT 1 FROM auth_identities i WHERE i.user_id = u.id)`,
  }),
  Object.freeze({
    code: 'identity_provider_secret_shape',
    domains: Object.freeze([PERSISTENCE_DOMAIN.IDENTITY]),
    sql: `SELECT COUNT(*)::integer AS count
            FROM auth_identities
           WHERE (provider = 'local' AND password_hash IS NULL)
              OR (provider <> 'local' AND password_hash IS NOT NULL)`,
  }),
  Object.freeze({
    code: 'organization_owner_mismatch',
    domains: Object.freeze([PERSISTENCE_DOMAIN.ORGANIZATIONS, PERSISTENCE_DOMAIN.AUTHORITY]),
    sql: `SELECT COUNT(*)::integer AS count
            FROM organizations o
           WHERE o.deleted_at IS NULL
             AND NOT EXISTS (
               SELECT 1 FROM organization_memberships m
                WHERE m.organization_id = o.id
                  AND m.user_id = o.owner_user_id
                  AND m.role = 'owner' AND m.status = 'active'
             )`,
  }),
  Object.freeze({
    code: 'challenge_without_version',
    domains: Object.freeze([PERSISTENCE_DOMAIN.CHALLENGES]),
    sql: `SELECT COUNT(*)::integer AS count
            FROM challenges c
           WHERE NOT EXISTS (SELECT 1 FROM challenge_versions v WHERE v.challenge_id = c.id)`,
  }),
  Object.freeze({
    code: 'legacy_hidden_challenge_case',
    domains: Object.freeze([PERSISTENCE_DOMAIN.CHALLENGES]),
    sql: `SELECT COUNT(*)::integer AS count
            FROM challenge_test_cases
           WHERE visibility = 'hidden'`,
  }),
  Object.freeze({
    code: 'course_without_version',
    domains: Object.freeze([PERSISTENCE_DOMAIN.COURSES]),
    sql: `SELECT COUNT(*)::integer AS count
            FROM courses c
           WHERE NOT EXISTS (SELECT 1 FROM course_versions v WHERE v.course_id = c.id)`,
  }),
  Object.freeze({
    code: 'social_author_shape',
    domains: Object.freeze([PERSISTENCE_DOMAIN.SOCIAL]),
    sql: `SELECT COUNT(*)::integer AS count
            FROM social_posts
           WHERE (author_user_id IS NULL) = (author_organization_id IS NULL)`,
  }),
  Object.freeze({
    code: 'idea_author_shape',
    domains: Object.freeze([PERSISTENCE_DOMAIN.IDEAS]),
    sql: `SELECT COUNT(*)::integer AS count
            FROM ideas
           WHERE (author_user_id IS NULL) = (author_organization_id IS NULL)`,
  }),
  Object.freeze({
    code: 'integration_cache_hash_shape',
    domains: Object.freeze([PERSISTENCE_DOMAIN.INTEGRATIONS]),
    sql: `SELECT COUNT(*)::integer AS count
            FROM integration_cache
           WHERE key_hash !~ '^[0-9a-f]{64}$'`,
  }),
]);

function stableJson(value) {
  if (value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function parseParityKey(rawValue) {
  if (!rawValue?.trim()) throw new Error('PERSISTENCE_PARITY_KEY is required.');
  const key = Buffer.from(rawValue.trim(), 'base64');
  if (
    key.length !== 32 ||
    key.toString('base64').replace(/=+$/, '') !== rawValue.trim().replace(/=+$/, '')
  ) {
    throw new Error('PERSISTENCE_PARITY_KEY must be canonical base64 for exactly 32 bytes.');
  }
  return key;
}

function signParityReport(report, key) {
  const reportSha256 = sha256(stableJson(report));
  const payload = { format: PARITY_FORMAT, report, reportSha256 };
  return Object.freeze({
    ...payload,
    authentication: Object.freeze({
      algorithm: 'HMAC-SHA-256',
      tag: createHmac('sha256', key).update(stableJson(payload)).digest('hex'),
    }),
  });
}

function verifyParityEnvelope(envelope, key) {
  if (!envelope || envelope.format !== PARITY_FORMAT || !envelope.report) {
    throw new Error('Parity report format is invalid.');
  }
  const expectedSha = sha256(stableJson(envelope.report));
  if (expectedSha !== envelope.reportSha256) throw new Error('Parity report checksum is invalid.');
  const payload = {
    format: envelope.format,
    report: envelope.report,
    reportSha256: envelope.reportSha256,
  };
  const expectedTag = createHmac('sha256', key).update(stableJson(payload)).digest('hex');
  const actual = Buffer.from(String(envelope.authentication?.tag || ''), 'hex');
  const expected = Buffer.from(expectedTag, 'hex');
  if (
    envelope.authentication?.algorithm !== 'HMAC-SHA-256' ||
    actual.length !== expected.length ||
    !timingSafeEqual(actual, expected)
  ) {
    throw new Error('Parity report authentication is invalid.');
  }
  return envelope;
}

function groupedCounts(rows, fields) {
  return rows
    .map((row) => Object.fromEntries([...fields, 'count'].map((field) => [field, row[field]])))
    .sort((left, right) => stableJson(left).localeCompare(stableJson(right)));
}

async function createParityReport(pool, { clock = () => new Date(), datasetSha256 }) {
  if (!pool || typeof pool.query !== 'function')
    throw new Error('A PostgreSQL query client is required.');
  if (!/^[a-f0-9]{64}$/.test(datasetSha256)) throw new Error('A dataset SHA-256 is required.');
  const runResult = await pool.query(
    `SELECT id, source_checksum, configuration_hash, state, summary, started_at, completed_at
       FROM import_runs
      WHERE source_checksum = $1 AND dry_run = false
      ORDER BY completed_at DESC NULLS LAST, id DESC
      LIMIT 1`,
    [datasetSha256],
  );
  const run = runResult.rows[0];
  if (!run || run.state !== 'reconciled') {
    throw new Error('A reconciled import run for the dataset is required.');
  }

  const [outcomeResult, exceptionResult] = await Promise.all([
    pool.query(
      `SELECT source_type, state, target_type, COUNT(*)::integer AS count
         FROM import_records WHERE import_run_id = $1
        GROUP BY source_type, state, target_type`,
      [run.id],
    ),
    pool.query(
      `SELECT source_type, code, severity, COUNT(*)::integer AS count
         FROM import_exceptions WHERE import_run_id = $1
        GROUP BY source_type, code, severity`,
      [run.id],
    ),
  ]);

  const missingTargets = [];
  for (const [targetType, target] of Object.entries(TARGET_TABLES)) {
    const result = await pool.query(
      `SELECT COUNT(*)::integer AS count
         FROM import_records r
         LEFT JOIN ${target.table} t ON t.${target.column}::text = r.target_id
        WHERE r.import_run_id = $1 AND r.state = 'imported'
          AND r.target_type = $2 AND t.${target.column} IS NULL`,
      [run.id, targetType],
    );
    missingTargets.push({ count: result.rows[0].count, targetType });
  }

  const tableCounts = {};
  for (const table of TABLE_COUNTS) {
    const result = await pool.query(`SELECT COUNT(*)::integer AS count FROM ${table}`);
    tableCounts[table] = result.rows[0].count;
  }

  const integrity = [];
  for (const check of INTEGRITY_CHECKS) {
    const result = await pool.query(check.sql);
    integrity.push({ code: check.code, count: result.rows[0].count, domains: check.domains });
  }

  const outcomes = groupedCounts(outcomeResult.rows, ['source_type', 'state', 'target_type']);
  const exceptions = groupedCounts(exceptionResult.rows, ['source_type', 'code', 'severity']);
  const sourceCollectionCounts = run.summary?.sourceCollectionCounts || {};
  const domains = {};
  for (const [domain, collections] of Object.entries(DOMAIN_COLLECTIONS)) {
    const domainOutcomes = outcomes.filter((entry) => collections.includes(entry.source_type));
    const domainExceptions = exceptions.filter((entry) => collections.includes(entry.source_type));
    const quarantined = domainOutcomes
      .filter((entry) => entry.state === 'quarantined')
      .reduce((sum, entry) => sum + entry.count, 0);
    const errorExceptions = domainExceptions
      .filter((entry) => entry.severity === 'error')
      .reduce((sum, entry) => sum + entry.count, 0);
    const targetTypes = new Set(
      domainOutcomes
        .filter((entry) => entry.state === 'imported')
        .map((entry) => entry.target_type)
        .filter(Boolean),
    );
    // Import outcome aggregates intentionally have no target identifier. Associate missing-target
    // checks through the root target types produced by each domain's source collections.
    const domainTargetTypes = new Set();
    for (const collection of collections) {
      if (collection === 'users') domainTargetTypes.add('user');
      if (collection === 'authidentities') domainTargetTypes.add('auth_identity');
      if (collection === 'organizations' || collection === 'companies')
        domainTargetTypes.add('organization');
      if (collection === 'organizationmemberships')
        domainTargetTypes.add('organization_membership');
      if (collection === 'companyemployees')
        domainTargetTypes.add('organization_membership_legacy');
      if (collection === 'providerverificationreviews')
        domainTargetTypes.add('provider_verification_review');
      if (collection === 'authority_controls') domainTargetTypes.add('authority_control');
      if (collection === 'authority_audit_events') domainTargetTypes.add('audit_event');
      if (collection === 'challenges') domainTargetTypes.add('challenge');
      if (collection === 'courses') domainTargetTypes.add('course');
      if (collection === 'enrollments') domainTargetTypes.add('enrollment');
      if (collection === 'posts') domainTargetTypes.add('post');
      if (collection === 'projects') domainTargetTypes.add('idea');
      if (collection === 'youtubecaches') domainTargetTypes.add('integration_cache');
    }
    for (const type of targetTypes) domainTargetTypes.add(type);
    const missing = missingTargets
      .filter((entry) => domainTargetTypes.has(entry.targetType))
      .reduce((sum, entry) => sum + entry.count, 0);
    const failedIntegrity = integrity
      .filter((entry) => entry.domains.includes(domain) && entry.count > 0)
      .map((entry) => ({ code: entry.code, count: entry.count }));
    const dataReady =
      quarantined === 0 && errorExceptions === 0 && missing === 0 && failedIntegrity.length === 0;
    domains[domain] = {
      adapterReady: POSTGRES_RUNTIME_READY_DOMAINS.has(domain),
      dataReady,
      errorExceptions,
      failedIntegrity,
      missingTargets: missing,
      quarantined,
      readyForCutover: dataReady && POSTGRES_RUNTIME_READY_DOMAINS.has(domain),
      sourceRecords: collections.reduce(
        (sum, collection) => sum + Number(sourceCollectionCounts[collection] || 0),
        0,
      ),
      warningCodes: [
        ...new Set(
          domainExceptions.filter((entry) => entry.severity !== 'error').map((entry) => entry.code),
        ),
      ].sort(),
    };
  }

  return Object.freeze({
    datasetSha256,
    domains,
    generatedAt: clock().toISOString(),
    import: {
      completedAt: run.completed_at?.toISOString?.() || String(run.completed_at),
      configurationHash: run.configuration_hash,
      counts: run.summary?.counts || null,
      planSha256: run.summary?.planSha256 || null,
      schemaVersion: run.summary?.schemaVersion || null,
      sourceCollectionCounts,
      sourceRecords: run.summary?.sourceRecords || 0,
      state: run.state,
    },
    integrity: integrity.map(({ code, count }) => ({ code, count })),
    missingTargets,
    outcomes,
    schemaVersion: 1,
    tableCounts,
  });
}

module.exports = {
  DOMAIN_COLLECTIONS,
  PARITY_FORMAT,
  createParityReport,
  parseParityKey,
  sha256,
  signParityReport,
  stableJson,
  verifyParityEnvelope,
};
