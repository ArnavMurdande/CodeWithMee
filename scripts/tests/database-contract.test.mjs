import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const loadCommonJs = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..', '..');
const schemaPath = path.join(root, 'prisma', 'schema.prisma');
const migrationPath = path.join(
  root,
  'prisma',
  'migrations',
  '20260801000100_core_baseline',
  'migration.sql',
);
const normalizedMigrationPath = path.join(
  root,
  'prisma',
  'migrations',
  '20260801000200_normalized_legacy_domains',
  'migration.sql',
);
const interactionMigrationPath = path.join(
  root,
  'prisma',
  'migrations',
  '20260801000300_normalized_legacy_interactions',
  'migration.sql',
);
const cutoverMigrationPath = path.join(
  root,
  'prisma',
  'migrations',
  '20260801000400_persistence_cutover_runtime',
  'migration.sql',
);
const restrictedContentMigrationPath = path.join(
  root,
  'prisma',
  'migrations',
  '20260801000500_restricted_content_formats',
  'migration.sql',
);
const operationReliabilityMigrationPath = path.join(
  root,
  'prisma',
  'migrations',
  '20260801000600_operation_reliability',
  'migration.sql',
);
const workflowPath = path.join(root, '.github', 'workflows', 'database.yml');
const lifecyclePath = path.join(root, 'server', 'test', 'database-lifecycle.js');
const schema = readFileSync(schemaPath, 'utf8');
const migration = readFileSync(migrationPath, 'utf8');
const normalizedMigration = readFileSync(normalizedMigrationPath, 'utf8');
const interactionMigration = readFileSync(interactionMigrationPath, 'utf8');
const cutoverMigration = readFileSync(cutoverMigrationPath, 'utf8');
const restrictedContentMigration = readFileSync(restrictedContentMigrationPath, 'utf8');
const operationReliabilityMigration = readFileSync(operationReliabilityMigrationPath, 'utf8');
/** @type {any} */
const migrationManifest = JSON.parse(
  readFileSync(path.join(root, 'prisma', 'migration-manifest.json'), 'utf8'),
);
const serverPackage = JSON.parse(readFileSync(path.join(root, 'server', 'package.json'), 'utf8'));
const { buildAuthorizationCatalog } = loadCommonJs(
  path.join(root, 'prisma', 'seed', 'authorization-catalog.cjs'),
);
const { assertDatabaseSafety } = loadCommonJs(
  path.join(root, 'server', 'scripts', 'database-safety.js'),
);

test('Prisma and PostgreSQL packages are exact and the baseline schema is immutable', () => {
  assert.equal(serverPackage.dependencies['@prisma/adapter-pg'], '7.9.1');
  assert.equal(serverPackage.dependencies['@prisma/client'], '7.9.1');
  assert.equal(serverPackage.dependencies.pg, '8.22.0');
  assert.equal(serverPackage.devDependencies.prisma, '7.9.1');

  assert.equal(createHash('sha256').update(schema).digest('hex'), migrationManifest.schema.sha256);
  assert.equal(Buffer.byteLength(schema), migrationManifest.schema.bytes);
});

test('core schema and SQL contain the fixed identity, organization, file, and operations baseline', () => {
  for (const model of [
    'User',
    'AuthIdentity',
    'Session',
    'SessionRefreshToken',
    'IdentityOneTimeToken',
    'Organization',
    'OrganizationMembership',
    'OrganizationInvitation',
    'ProviderVerificationReview',
    'FileObject',
    'AuthorityControl',
    'AuditEvent',
    'IdempotencyKey',
    'OutboxEvent',
    'JobRun',
    'ImportRun',
  ]) {
    assert.match(schema, new RegExp(`model ${model} \\{`));
  }

  for (const contract of [
    'session_refresh_tokens_one_current_per_session',
    'identity_one_time_tokens_one_unconsumed_per_kind',
    'organization_memberships_one_active_owner',
    'organization_invitations_one_pending_per_role',
    'provider_verification_reviews_one_pending_per_org',
    'organizations_owner_invariant',
    'files_exactly_one_owner_check',
    'files_ready_state_check',
    'audit_events_append_only',
    'superadmin_bootstrap_v1',
  ]) {
    assert.match(migration, new RegExp(contract));
  }
  assert.doesNotMatch(migration, /CREATE\s+(?:USER|ROLE).*SUPERADMIN/i);
  assert.doesNotMatch(migration, /DROP\s+(?:DATABASE|SCHEMA)/i);
});

test('normalized legacy domains are additive, relational, constrained, and checksum pinned', () => {
  for (const model of [
    'LearningProfile',
    'LearningRoadmap',
    'LearningTopic',
    'LearningNote',
    'VideoProgress',
    'SocialProfile',
    'SocialRelationship',
    'UserBlock',
    'Challenge',
    'ChallengeVersion',
    'ChallengeTestCase',
    'Course',
    'CourseVersion',
    'CourseModule',
    'CourseContent',
    'Enrollment',
    'CourseProgressImportSnapshot',
    'SocialPost',
    'SocialComment',
    'SocialCommentReaction',
    'SocialCommentSave',
    'Idea',
    'IdeaMilestone',
    'IdeaUpdate',
    'IntegrationCache',
  ]) {
    assert.match(schema, new RegExp(`model ${model} \\{`));
  }
  for (const contract of [
    'social_relationships_not_self_check',
    'user_blocks_not_self_check',
    'challenges_score_attempts_check',
    'courses_price_check',
    'course_progress_import_snapshots_check',
    'social_posts_exactly_one_author_check',
    'social_comments_exactly_one_author_check',
    'ideas_exactly_one_author_check',
    'integration_cache_key_value_check',
  ]) {
    assert.match(normalizedMigration, new RegExp(contract));
  }
  assert.doesNotMatch(normalizedMigration, /DROP\s+(?:TABLE|SCHEMA|DATABASE)/i);
  const entry = migrationManifest.migrations.find(
    (/** @type {{name: string}} */ candidate) =>
      candidate.name === '20260801000200_normalized_legacy_domains',
  );
  assert.ok(entry);
  assert.equal(createHash('sha256').update(normalizedMigration).digest('hex'), entry.sha256);
  assert.equal(Buffer.byteLength(normalizedMigration), entry.bytes);
  for (const contract of [
    'social_comment_reactions_kind_check',
    'idea_updates_exactly_one_author_check',
  ]) {
    assert.match(interactionMigration, new RegExp(contract));
  }
  const interactionEntry = migrationManifest.migrations.find(
    (/** @type {{name: string}} */ candidate) =>
      candidate.name === '20260801000300_normalized_legacy_interactions',
  );
  assert.ok(interactionEntry);
  assert.equal(
    createHash('sha256').update(interactionMigration).digest('hex'),
    interactionEntry.sha256,
  );
  assert.equal(Buffer.byteLength(interactionMigration), interactionEntry.bytes);
});

test('PostgreSQL authority runtime audit metadata is additive and checksum pinned', () => {
  for (const field of ['actorSessionId', 'requestId', 'occurredAt']) {
    assert.match(schema, new RegExp(`\\b${field}\\b`));
  }
  for (const column of ['actor_session_id', 'request_id', 'occurred_at']) {
    assert.match(cutoverMigration, new RegExp(column));
  }
  assert.doesNotMatch(cutoverMigration, /DROP\s+(?:TABLE|SCHEMA|DATABASE|COLUMN)/i);
  const entry = migrationManifest.migrations.find(
    (/** @type {{name: string}} */ candidate) =>
      candidate.name === '20260801000400_persistence_cutover_runtime',
  );
  assert.ok(entry);
  assert.equal(createHash('sha256').update(cutoverMigration).digest('hex'), entry.sha256);
  assert.equal(Buffer.byteLength(cutoverMigration), entry.bytes);
});

test('restricted content formats are explicit, additive, and checksum pinned', () => {
  assert.match(schema, /responseFormat\s+String/);
  assert.match(schema, /contentFormat\s+String/);
  assert.match(restrictedContentMigration, /restricted_markdown_v1/);
  assert.match(restrictedContentMigration, /plain_text_v1/);
  assert.doesNotMatch(restrictedContentMigration, /DROP\s+(?:TABLE|SCHEMA|DATABASE|COLUMN)/i);
  const entry = migrationManifest.migrations.find(
    (/** @type {{name: string}} */ candidate) =>
      candidate.name === '20260801000500_restricted_content_formats',
  );
  assert.ok(entry);
  assert.equal(createHash('sha256').update(restrictedContentMigration).digest('hex'), entry.sha256);
  assert.equal(Buffer.byteLength(restrictedContentMigration), entry.bytes);
});

test('durable idempotency leases are additive, constrained, indexed, and checksum pinned', () => {
  assert.match(schema, /leaseId\s+String\?/);
  assert.match(schema, /leaseExpiresAt\s+DateTime\?/);
  assert.match(operationReliabilityMigration, /idempotency_keys_lease_pair_check/);
  assert.match(operationReliabilityMigration, /idempotency_keys_completion_lease_check/);
  assert.match(operationReliabilityMigration, /idempotency_keys_lease_expires_at_idx/);
  assert.doesNotMatch(
    operationReliabilityMigration,
    /DROP\s+(?:TABLE|SCHEMA|DATABASE|COLUMN)|DELETE\s+FROM|TRUNCATE/i,
  );
  const entry = migrationManifest.migrations.find(
    (/** @type {{name: string}} */ candidate) =>
      candidate.name === '20260801000600_operation_reliability',
  );
  assert.ok(entry);
  assert.equal(
    createHash('sha256').update(operationReliabilityMigration).digest('hex'),
    entry.sha256,
  );
  assert.equal(Buffer.byteLength(operationReliabilityMigration), entry.bytes);
});

test('authorization seed exactly covers policy permissions and contains no human account seed', () => {
  /** @type {{grants: Record<string, string[]>, permissions: Array<{key: string}>, roles: Array<{key: string}>}} */
  const catalog = buildAuthorizationCatalog();
  const permissionKeys = new Set(catalog.permissions.map((permission) => permission.key));
  const roleKeys = new Set(catalog.roles.map((role) => role.key));
  assert.ok(roleKeys.has('platform:superadmin'));
  assert.ok(roleKeys.has('organization:owner'));
  assert.ok(roleKeys.has('course:payment_reviewer'));
  assert.ok(permissionKeys.has('platform:roles:manage'));
  assert.ok(permissionKeys.has('organizations:ownership:transfer'));
  for (const [roleKey, grants] of Object.entries(catalog.grants)) {
    assert.ok(roleKeys.has(roleKey));
    assert.equal(grants.length, new Set(grants).size);
    for (const grant of grants) assert.ok(permissionKeys.has(grant), `${roleKey}: ${grant}`);
  }

  const seedSource = readFileSync(path.join(root, 'server', 'scripts', 'seed-database.js'), 'utf8');
  assert.doesNotMatch(seedSource, /INSERT INTO users/i);
  assert.doesNotMatch(seedSource, /UPDATE users/i);
});

test('database mutation guard fails closed for ambiguous or dangerous targets', () => {
  assert.throws(() => assertDatabaseSafety('seed', {}), /DATABASE_URL is required/);
  assert.throws(
    () =>
      assertDatabaseSafety('seed', {
        DATABASE_SAFETY_SCOPE: 'disposable',
        DATABASE_URL: 'postgresql://user:pass@example.com/codewithmee_ci',
      }),
    /loopback/,
  );
  assert.throws(
    () =>
      assertDatabaseSafety('migrate-deploy', {
        DATABASE_DEPLOY_APPROVAL: 'production:codewithmee',
        DATABASE_SAFETY_SCOPE: 'production',
        DATABASE_URL: 'postgresql://postgres:pass@db.example.com/codewithmee',
      }),
    /superuser/,
  );
  assert.doesNotThrow(() =>
    assertDatabaseSafety('migrate-deploy', {
      DATABASE_SAFETY_SCOPE: 'disposable',
      DATABASE_URL: 'postgresql://codewithmee:local@127.0.0.1:5432/codewithmee_ci',
    }),
  );
});

test('database CI isolates, migrates, reseeds, tests, restores, and cleans PostgreSQL 16', () => {
  const workflow = readFileSync(workflowPath, 'utf8');
  const lifecycle = readFileSync(lifecyclePath, 'utf8');
  assert.match(workflow, /postgres:16\.14-bookworm/);
  assert.match(workflow, /DATABASE_SAFETY_SCOPE: disposable/);
  assert.match(workflow, /DATABASE_ADMIN_URL: .*127\.0\.0\.1.*\/postgres/);
  assert.match(workflow, /DATABASE_TEST_PREFIX: codewithmee_p0f/);
  assert.doesNotMatch(workflow, /^\s+DATABASE_URL:/m);
  assert.match(workflow, /test:database:integration/);
  assert.match(workflow, /permissions:\s*[\s\S]*contents: read/);
  assert.match(lifecycle, /CREATE DATABASE/);
  assert.equal((lifecycle.match(/DROP DATABASE IF EXISTS/g) || []).length, 2);
  assert.equal((lifecycle.match(/\['seed'\]/g) || []).length, 2);
  assert.match(lifecycle, /test\/database-integration\.js/);
  assert.match(lifecycle, /test\/portable-backup-integration\.js/);
  assert.match(lifecycle, /SELECT datname FROM pg_database WHERE datname = ANY\(\$1\)/);

  const digest = createHash('sha256').update(migration).digest('hex');
  assert.equal(digest, migrationManifest.migration.sha256);
  assert.equal(Buffer.byteLength(migration), migrationManifest.migration.bytes);
  assert.equal(migrationManifest.prisma, '7.9.1');
  const migrationDirectories = readdirSync(path.join(root, 'prisma', 'migrations'), {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const entry of migrationManifest.migrations) {
    const contents = readFileSync(path.join(root, entry.path));
    assert.equal(contents.byteLength, entry.bytes, `${entry.name} byte count`);
    assert.equal(
      createHash('sha256').update(contents).digest('hex'),
      entry.sha256,
      `${entry.name} checksum`,
    );
  }
  assert.deepEqual(
    migrationManifest.migrations.map((/** @type {{name: string}} */ entry) => entry.name),
    migrationDirectories,
  );
  assert.deepEqual(migrationDirectories, [
      '20260801000100_core_baseline',
      '20260801000200_normalized_legacy_domains',
      '20260801000300_normalized_legacy_interactions',
      '20260801000400_persistence_cutover_runtime',
      '20260801000500_restricted_content_formats',
      '20260801000600_operation_reliability',
      '20260810000100_add_starter_templates',
      '20260810000200_challenge_status_enum',
      '20260810000300_add_challenge_submissions',
      '20260810000400_add_lesson_progress',
      '20260810000600_add_execution_jobs',
      '20260810000700_add_course_publication_status',
      '20260810000800_add_lesson_progress_lookup',
      '20260810000900_align_execution_job_foreign_keys',
      '20260810001000_bind_enrollments_to_course_versions',
      '20260810001100_add_course_content_duration',
      '20260810001200_complete_provider_lms',
      '20260810001300_add_quiz_grading_feedback',
      '20260810001400_add_course_uploaded_media',
      '20260810001500_version_course_publication',
  ]);
});
