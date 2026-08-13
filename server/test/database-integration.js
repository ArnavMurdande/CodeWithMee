'use strict';

const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { buildAuthorizationCatalog } = require('../../prisma/seed/authorization-catalog.cjs');
const { FILE_SCAN_STATUS, FILE_VISIBILITY } = require('../modules/files/contracts');
const { createMemoryObjectStore } = require('../modules/files/object-store');
const { createPostgresFileRepository } = require('../modules/files/postgres-repository');
const { reconcileFiles } = require('../modules/files/reconciliation');
const { createFileService } = require('../modules/files/service');
const { createPostgresAuthorityRepository } = require('../modules/authority/postgres-repository');
const { createPostgresIdentityRepository } = require('../modules/identity/postgres-repository');
const {
  createPostgresOrganizationRepository,
} = require('../modules/organizations/postgres-repository');
const { createPostgresRoadmapRepository } = require('../modules/learning/postgres-roadmap-repository');
const { createParityReport, signParityReport } = require('../modules/persistence/parity-report');
const {
  loadPersistenceRuntimeConfig,
  targetDatabaseName,
  verifyPersistenceActivation,
} = require('../modules/persistence/runtime');
const { assertDatabaseSafety } = require('../scripts/database-safety');
const { activate, rollback } = require('../scripts/persistence-cutover');

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function expectConstraint(client, query, parameters, pattern) {
  await assert.rejects(
    client.query(query, parameters),
    (error) => ['23505', '23514', '55000'].includes(error.code) && pattern.test(error.message),
  );
}

async function expectDeferredConstraint(client, statements, pattern) {
  await client.query('BEGIN');
  try {
    for (const [query, parameters] of statements) await client.query(query, parameters);
    await assert.rejects(
      client.query('COMMIT'),
      (error) => error.code === '23514' && pattern.test(error.message),
    );
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
  }
}

async function main() {
  assertDatabaseSafety('integration-test');
  assert.equal(process.env.DATABASE_SAFETY_SCOPE, 'disposable');

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 6 });
  const client = await pool.connect();
  const firstUserId = randomUUID();
  const secondUserId = randomUUID();
  const organizationId = randomUUID();
  const firstMembershipId = randomUUID();
  const secondMembershipId = randomUUID();
  const firstEmail = `owner-${firstUserId}@example.test`;
  const secondEmail = `next-owner-${secondUserId}@example.test`;

  try {
    const migrations = await client.query(
      `SELECT migration_name, finished_at, rolled_back_at
       FROM _prisma_migrations
       ORDER BY migration_name`,
    );
    assert.deepEqual(
      migrations.rows.map((row) => row.migration_name),
      [
        '20260801000100_core_baseline',
        '20260801000200_normalized_legacy_domains',
        '20260801000300_normalized_legacy_interactions',
        '20260801000400_persistence_cutover_runtime',
        '20260801000500_restricted_content_formats',
        '20260801000600_operation_reliability',
      ],
    );
    assert.ok(migrations.rows.every((row) => row.finished_at && row.rolled_back_at === null));

    const tableCount = await client.query(
      `SELECT count(*)::int AS count
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    );
    assert.ok(tableCount.rows[0].count >= 26);

    const catalog = buildAuthorizationCatalog();
    const catalogCounts = await client.query(
      `SELECT
         (SELECT count(*)::int FROM permission_definitions) AS permissions,
         (SELECT count(*)::int FROM role_definitions WHERE builtin) AS roles,
         (SELECT count(*)::int FROM role_permissions) AS grants`,
    );
    assert.equal(catalogCounts.rows[0].permissions, catalog.permissions.length);
    assert.equal(catalogCounts.rows[0].roles, catalog.roles.length);
    assert.equal(
      catalogCounts.rows[0].grants,
      Object.values(catalog.grants).reduce((total, values) => total + values.length, 0),
    );

    await client.query(
      `INSERT INTO users
       (id, email_normalized, email_display, display_name)
       VALUES ($1, $3, $3, 'Owner'),
              ($2, $4, $4, 'Next Owner')`,
      [firstUserId, secondUserId, firstEmail, secondEmail],
    );
    const seededSuperadmins = await client.query(
      "SELECT count(*)::int AS count FROM users WHERE platform_role = 'superadmin'",
    );
    assert.equal(seededSuperadmins.rows[0].count, 0);

    // --- Live PostgreSQL Roadmap Repository & User Data Isolation Verification ---
    const roadmapRepo = createPostgresRoadmapRepository(pool);
    const liveRoadmapA = await roadmapRepo.createRoadmap(firstUserId, {
      title: 'Live PostgreSQL Pathway',
      topics: [{ topic: 'Topic 1', description: 'Desc 1', youtube_query: 'yt 1' }],
    });
    const liveRoadmapB = await roadmapRepo.createRoadmap(secondUserId, {
      title: 'Live PostgreSQL Pathway',
      topics: [{ topic: 'Topic 1', description: 'Desc 1', youtube_query: 'yt 1' }],
    });
    assert.notEqual(liveRoadmapA.id, liveRoadmapB.id);
    assert.equal(liveRoadmapA.topics[0].completed, false);
    assert.equal(liveRoadmapB.topics[0].completed, false);

    const roadmapsForUser1 = await roadmapRepo.getRoadmaps(firstUserId);
    assert.ok(roadmapsForUser1.some((r) => r.id === liveRoadmapA.id));
    assert.ok(!roadmapsForUser1.some((r) => r.id === liveRoadmapB.id));

    const readAttemptB = await roadmapRepo.getRoadmapById(firstUserId, liveRoadmapB.id);
    assert.equal(readAttemptB, null);

    const updateAttemptUser1OnUser2 = await roadmapRepo.updateTopicProgress(firstUserId, {
      roadmapId: liveRoadmapB.id,
      topicId: liveRoadmapB.topics[0].id,
      completed: true,
    });
    assert.equal(updateAttemptUser1OnUser2, null);

    const deleteAttemptUser1OnUser2 = await roadmapRepo.deleteRoadmap(firstUserId, liveRoadmapB.id);
    assert.equal(deleteAttemptUser1OnUser2, false);

    await roadmapRepo.deleteRoadmap(firstUserId, liveRoadmapA.id);
    await roadmapRepo.deleteRoadmap(secondUserId, liveRoadmapB.id);

    await expectConstraint(
      client,
      `INSERT INTO learning_conversations
       (user_id, context, prompt, response, response_format)
       VALUES ($1, 'general', 'prompt', 'response', 'raw_html')`,
      [firstUserId],
      /learning_conversations_response_format_check/,
    );
    await expectConstraint(
      client,
      `INSERT INTO learning_notes (user_id, title, content, content_format)
       VALUES ($1, 'Unsafe format', '<script>', 'html_v1')`,
      [firstUserId],
      /learning_notes_content_format_check/,
    );
    const leaseId = randomUUID();
    await expectConstraint(
      client,
      `INSERT INTO idempotency_keys
       (actor_user_id, action, key, request_hash, lease_id, expires_at)
       VALUES ($1, 'integration', 'unpaired-lease', $2, $3, now() + interval '1 hour')`,
      [firstUserId, 'a'.repeat(64), leaseId],
      /idempotency_keys_lease_pair_check/,
    );
    await expectConstraint(
      client,
      `INSERT INTO idempotency_keys
       (actor_user_id, action, key, request_hash, response_status, lease_id, lease_expires_at, expires_at)
       VALUES ($1, 'integration', 'completed-lease', $2, 200, $3,
               now() + interval '5 minutes', now() + interval '1 hour')`,
      [firstUserId, 'b'.repeat(64), randomUUID()],
      /idempotency_keys_completion_lease_check/,
    );

    await expectConstraint(
      client,
      `INSERT INTO auth_identities (user_id, provider, provider_subject)
       VALUES ($1, 'local', $2)`,
      [firstUserId, firstEmail],
      /auth_identities_password_provider_check/,
    );
    await client.query(
      `INSERT INTO auth_identities (user_id, provider, provider_subject, password_hash)
       VALUES ($1, 'local', $2, '$argon2id$v=19$m=65536,t=3,p=1$fixture$fixture')`,
      [firstUserId, firstEmail],
    );

    const sessionId = randomUUID();
    await client.query(
      `INSERT INTO sessions
       (id, user_id, client, family_id, authenticated_at, absolute_expires_at,
        idle_expires_at, last_used_at, csrf_secret_hash)
       VALUES ($1, $2, 'web', $3, now(), now() + interval '30 days',
               now() + interval '1 day', now(), $4)`,
      [sessionId, firstUserId, randomUUID(), digest(`csrf:${sessionId}`)],
    );
    await client.query(
      `INSERT INTO session_refresh_tokens
       (session_id, token_hash, issued_at, expires_at)
       VALUES ($1, $2, now(), now() + interval '1 day')`,
      [sessionId, digest(`refresh-current:${sessionId}`)],
    );
    await expectConstraint(
      client,
      `INSERT INTO session_refresh_tokens
       (session_id, token_hash, issued_at, expires_at)
       VALUES ($1, $2, now(), now() + interval '1 day')`,
      [sessionId, digest(`refresh-second:${sessionId}`)],
      /one_current_per_session/,
    );

    await client.query(
      `INSERT INTO identity_one_time_tokens (user_id, kind, token_hash, expires_at)
       VALUES ($1, 'email_verification', $2, now() + interval '1 hour')`,
      [firstUserId, digest(`verify-current:${firstUserId}`)],
    );
    await expectConstraint(
      client,
      `INSERT INTO identity_one_time_tokens (user_id, kind, token_hash, expires_at)
       VALUES ($1, 'email_verification', $2, now() + interval '1 hour')`,
      [firstUserId, digest(`verify-second:${firstUserId}`)],
      /one_unconsumed_per_kind/,
    );

    await expectDeferredConstraint(
      client,
      [
        [
          `INSERT INTO organizations (id, slug, name, owner_user_id)
           VALUES ($1, 'missing-owner-membership', 'Missing Owner Membership', $2)`,
          [randomUUID(), firstUserId],
        ],
      ],
      /organization_owner_invariant_violation/,
    );

    await client.query('BEGIN');
    await client.query(
      `INSERT INTO organizations (id, slug, name, owner_user_id)
       VALUES ($1, $3, 'Verified Owner Invariant', $2)`,
      [organizationId, firstUserId, `verified-owner-${organizationId}`],
    );
    await client.query(
      `INSERT INTO organization_memberships (id, organization_id, user_id, role, status)
       VALUES ($1, $2, $3, 'owner', 'active')`,
      [firstMembershipId, organizationId, firstUserId],
    );
    await client.query('COMMIT');

    await expectConstraint(
      client,
      `INSERT INTO organization_memberships (organization_id, user_id, role, status)
       VALUES ($1, $2, 'owner', 'active')`,
      [organizationId, secondUserId],
      /one_active_owner/,
    );
    await client.query(
      `INSERT INTO organization_memberships (id, organization_id, user_id, role, status)
       VALUES ($1, $2, $3, 'admin', 'active')`,
      [secondMembershipId, organizationId, secondUserId],
    );

    await client.query('BEGIN');
    await client.query(
      `UPDATE organization_memberships
       SET role = CASE WHEN user_id = $1 THEN 'admin'::organization_role ELSE 'owner'::organization_role END,
           revision = revision + 1,
           updated_at = now()
       WHERE organization_id = $2 AND user_id IN ($1, $3)`,
      [firstUserId, organizationId, secondUserId],
    );
    await client.query(
      'UPDATE organizations SET owner_user_id = $1, revision = revision + 1, updated_at = now() WHERE id = $2',
      [secondUserId, organizationId],
    );
    await client.query('COMMIT');

    await expectDeferredConstraint(
      client,
      [
        [
          `UPDATE organization_memberships
           SET status = 'revoked', revoked_at = now(), revision = revision + 1
           WHERE id = $1`,
          [secondMembershipId],
        ],
      ],
      /organization_owner_invariant_violation/,
    );

    await expectConstraint(
      client,
      `INSERT INTO files
       (uploaded_by_user_id, purpose, storage_bucket, storage_key, original_name,
        declared_mime, byte_size)
       VALUES ($1, 'avatar', 'private', 'users/no-owner', 'avatar.png', 'image/png', 10)`,
      [firstUserId],
      /files_exactly_one_owner_check/,
    );
    await expectConstraint(
      client,
      `INSERT INTO files
       (owner_user_id, uploaded_by_user_id, purpose, storage_bucket, storage_key,
        original_name, declared_mime, byte_size, state)
       VALUES ($1, $1, 'avatar', 'private', 'users/not-scanned', 'avatar.png',
               'image/png', 10, 'ready')`,
      [firstUserId],
      /files_ready_state_check/,
    );

    const fileBody = Buffer.from('verified-private-file');
    const fileRepository = createPostgresFileRepository(pool);
    const objectStore = createMemoryObjectStore();
    const fileService = createFileService({ objectStore, repository: fileRepository });
    const fileIntent = await fileService.createUploadIntent(
      { principal: { userId: firstUserId } },
      {
        byteSize: fileBody.length,
        declaredMime: 'image/png',
        originalName: 'avatar.png',
        ownerType: 'user',
        purpose: 'profile_avatar',
        sha256: digest(fileBody),
      },
    );
    await objectStore.acceptUpload(fileIntent.file.id, fileBody);
    await fileService.completeUpload({ principal: { userId: firstUserId } }, fileIntent.file.id);
    await fileService.applyTrustedScanResult({
      byteSize: fileBody.length,
      detectedMime: 'image/png',
      fileId: fileIntent.file.id,
      scanStatus: FILE_SCAN_STATUS.CLEAN,
      sha256: digest(fileBody),
    });
    await fileService.setVisibility(
      { principal: { userId: firstUserId } },
      fileIntent.file.id,
      FILE_VISIBILITY.PUBLIC,
    );
    const readyFile = await client.query(
      'SELECT state, scan_status, visibility, sha256 FROM files WHERE id = $1',
      [fileIntent.file.id],
    );
    assert.deepEqual(readyFile.rows[0], {
      scan_status: 'clean',
      sha256: digest(fileBody),
      state: 'ready',
      visibility: 'public',
    });
    const fileEvents = await client.query(
      "SELECT event_type FROM outbox_events WHERE aggregate_type = 'file' AND aggregate_id = $1 ORDER BY created_at, id",
      [fileIntent.file.id],
    );
    assert.deepEqual(
      new Set(fileEvents.rows.map((row) => row.event_type)),
      new Set(['file.ready', 'file.scan.requested', 'file.visibility.changed']),
    );
    await fileService.deleteFile({ principal: { userId: firstUserId } }, fileIntent.file.id);
    const deletedFile = await client.query('SELECT state, deleted_at FROM files WHERE id = $1', [
      fileIntent.file.id,
    ]);
    assert.equal(deletedFile.rows[0].state, 'deleted');
    assert.ok(deletedFile.rows[0].deleted_at);
    const reconciliationKey = Buffer.alloc(32, 31);
    const cleanReconciliation = await reconcileFiles({
      bucket: objectStore.bucket,
      fingerprintKey: reconciliationKey,
      legacyInventory: { available: true, exceptions: [], files: [], totals: {} },
      objectStore,
      prefix: objectStore.basePrefix,
      repository: fileRepository,
    });
    assert.equal(cleanReconciliation.readyForLegacyRetirement, true);
    const orphanRecord = {
      byteSize: fileBody.length,
      declaredMime: 'image/png',
      id: randomUUID(),
      sha256: digest(fileBody),
      storageKey: `${objectStore.basePrefix}/profile_avatar/2026/08/${randomUUID()}`,
    };
    await objectStore.putUncheckedForTest(orphanRecord, fileBody);
    const blockedReconciliation = await reconcileFiles({
      bucket: objectStore.bucket,
      fingerprintKey: reconciliationKey,
      legacyInventory: { available: true, exceptions: [], files: [], totals: {} },
      objectStore,
      prefix: objectStore.basePrefix,
      repository: fileRepository,
    });
    assert.equal(blockedReconciliation.readyForLegacyRetirement, false);
    assert.equal(blockedReconciliation.summary.issueCounts.storage_object_orphaned, 1);
    await objectStore.deleteObject(orphanRecord);

    const auditId = randomUUID();
    await client.query(
      `INSERT INTO audit_events
       (id, actor_user_id, action, target_type, target_id, reason, source, after_state)
       VALUES ($1, $2, 'integration_check', 'user', $3,
                'Database invariant integration check', 'test', '{"status":"active"}'::jsonb)`,
      [auditId, firstUserId, firstUserId],
    );
    await expectConstraint(
      client,
      'UPDATE audit_events SET reason = $1 WHERE id = $2',
      ['tampered', auditId],
      /append-only/,
    );
    await expectConstraint(
      client,
      'DELETE FROM audit_events WHERE id = $1',
      [auditId],
      /append-only/,
    );

    const controls = await client.query(
      `SELECT key, consumed_at FROM authority_controls
       WHERE key IN ('platform_authority', 'superadmin_bootstrap_v1') ORDER BY key`,
    );
    assert.equal(controls.rowCount, 2);
    assert.ok(controls.rows.every((row) => row.consumed_at === null));

    const identityRepository = createPostgresIdentityRepository(pool);
    const organizationRepository = createPostgresOrganizationRepository(pool);
    const authorityRepository = createPostgresAuthorityRepository(pool);
    const adapterNow = new Date('2026-08-01T12:00:00.000Z');
    const adapterActorEmail = `postgres-actor-${randomUUID()}@example.test`;
    const adapterTargetEmail = `postgres-target-${randomUUID()}@example.test`;
    const adapterActor = await identityRepository.createUserWithIdentity({
      identity: {
        passwordHash: '$argon2id$v=19$m=65536,t=3,p=1$fixture$fixture',
        provider: 'local',
        providerSubject: adapterActorEmail,
      },
      user: {
        displayName: 'Postgres Actor',
        email: adapterActorEmail,
        emailVerifiedAt: adapterNow,
        platformRole: 'learner',
        status: 'active',
        username: null,
      },
    });
    const adapterTarget = await identityRepository.createUserWithIdentity({
      identity: {
        passwordHash: '$argon2id$v=19$m=65536,t=3,p=1$fixture$fixture',
        provider: 'local',
        providerSubject: adapterTargetEmail,
      },
      user: {
        displayName: 'Postgres Target',
        email: adapterTargetEmail,
        emailVerifiedAt: adapterNow,
        platformRole: 'learner',
        status: 'active',
        username: null,
      },
    });
    assert.equal(
      (await identityRepository.findUserByEmail(adapterActorEmail)).id,
      adapterActor.user.id,
    );

    const refreshFamily = randomUUID();
    const firstRefreshHash = digest(`adapter-refresh:${refreshFamily}:one`);
    const secondRefreshHash = digest(`adapter-refresh:${refreshFamily}:two`);
    await identityRepository.createSession({
      authenticatedAt: adapterNow,
      client: 'web',
      compromisedAt: null,
      consumedTokenHashes: [],
      createdAt: adapterNow,
      csrfTokenHash: digest(`adapter-csrf:${refreshFamily}:one`),
      currentTokenHash: firstRefreshHash,
      expiresAt: new Date('2026-09-01T12:00:00.000Z'),
      id: refreshFamily,
      idleExpiresAt: new Date('2026-08-02T12:00:00.000Z'),
      ipHash: digest(`adapter-ip:${refreshFamily}`),
      lastUsedAt: adapterNow,
      revokedAt: null,
      userAgent: 'integration-test-agent',
      userId: adapterTarget.user.id,
    });
    const rotated = await identityRepository.rotateSession({
      currentTokenHash: firstRefreshHash,
      idleExpiresAt: new Date('2026-08-03T12:00:00.000Z'),
      nextCsrfTokenHash: digest(`adapter-csrf:${refreshFamily}:two`),
      nextTokenHash: secondRefreshHash,
      now: new Date('2026-08-01T12:05:00.000Z'),
      sessionId: refreshFamily,
    });
    assert.equal(rotated.outcome, 'rotated');
    assert.equal(rotated.session.currentTokenHash, secondRefreshHash);
    assert.ok(rotated.session.consumedTokenHashes.includes(firstRefreshHash));
    const reused = await identityRepository.rotateSession({
      currentTokenHash: firstRefreshHash,
      idleExpiresAt: new Date('2026-08-03T12:00:00.000Z'),
      nextCsrfTokenHash: digest(`adapter-csrf:${refreshFamily}:three`),
      nextTokenHash: digest(`adapter-refresh:${refreshFamily}:three`),
      now: new Date('2026-08-01T12:06:00.000Z'),
      sessionId: refreshFamily,
    });
    assert.equal(reused.outcome, 'reused');
    assert.ok(reused.session.compromisedAt);
    assert.ok(reused.session.revokedAt);

    const oneTimeId = randomUUID();
    const oneTimeHash = digest(`adapter-one-time:${oneTimeId}`);
    await identityRepository.createOneTimeToken({
      consumedAt: null,
      createdAt: adapterNow,
      expiresAt: new Date('2026-08-02T12:00:00.000Z'),
      id: oneTimeId,
      purpose: 'email_verification',
      tokenHash: oneTimeHash,
      userId: adapterTarget.user.id,
    });
    const consumedOneTime = await identityRepository.consumeOneTimeToken({
      consumedAt: new Date('2026-08-01T12:10:00.000Z'),
      purpose: 'email_verification',
      tokenHash: oneTimeHash,
      tokenId: oneTimeId,
    });
    assert.equal(consumedOneTime.id, oneTimeId);

    const adapterOrganizationId = randomUUID();
    const adapterMembershipId = randomUUID();
    const adapterOrganization = await organizationRepository.createOrganizationWithOwner({
      membership: {
        createdAt: adapterNow,
        id: adapterMembershipId,
        invitedByUserId: null,
        joinedAt: adapterNow,
        role: 'owner',
        status: 'active',
        userId: adapterActor.user.id,
      },
      organization: {
        createdAt: adapterNow,
        description: 'Runtime adapter integration organization',
        id: adapterOrganizationId,
        industry: 'education',
        logoFile: null,
        name: 'Postgres Runtime Organization',
        ownerUserId: adapterActor.user.id,
        slug: `postgres-runtime-${adapterOrganizationId}`,
        verificationStatus: 'draft',
      },
    });
    assert.equal(adapterOrganization.membership.role, 'owner');
    const invitationId = randomUUID();
    const invitationHash = digest(`adapter-invitation:${invitationId}`);
    await organizationRepository.createInvitation({
      acceptedAt: null,
      acceptedByUserId: null,
      createdAt: adapterNow,
      email: adapterTargetEmail,
      expiresAt: new Date('2026-08-08T12:00:00.000Z'),
      id: invitationId,
      invitedByUserId: adapterActor.user.id,
      organizationId: adapterOrganizationId,
      revokedAt: null,
      role: 'admin',
      tokenHash: invitationHash,
    });
    const acceptedInvitation = await organizationRepository.consumeInvitation({
      acceptedAt: new Date('2026-08-01T12:15:00.000Z'),
      email: adapterTargetEmail,
      invitationId,
      tokenHash: invitationHash,
      userId: adapterTarget.user.id,
    });
    assert.equal(acceptedInvitation.membership.role, 'admin');
    const reviewId = randomUUID();
    const review = await organizationRepository.createVerificationReview({
      organizationId: adapterOrganizationId,
      review: {
        id: reviewId,
        statement: 'This fixture verifies the PostgreSQL provider review transaction.',
        submittedByUserId: adapterActor.user.id,
      },
      submittedAt: new Date('2026-08-01T12:20:00.000Z'),
    });
    assert.equal(review.review.status, 'pending_review');
    const decidedReview = await organizationRepository.decideVerificationReview({
      decidedAt: new Date('2026-08-01T12:25:00.000Z'),
      decisionReason: 'Integration approval evidence is complete.',
      reviewId,
      reviewerUserId: adapterTarget.user.id,
      status: 'approved',
    });
    assert.equal(decidedReview.organization.verificationStatus, 'approved');

    const bootstrap = await authorityRepository.bootstrapSuperadmin({
      email: adapterActorEmail,
      event: {
        action: 'superadmin_bootstrap',
        actorSessionId: null,
        actorUserId: null,
        id: randomUUID(),
        occurredAt: new Date('2026-08-01T12:30:00.000Z'),
        operatorReference: 'integration-change-record',
        reason: 'Integration bootstrap verifies the PostgreSQL authority transaction.',
        requestId: null,
        source: 'bootstrap_cli',
      },
    });
    assert.equal(bootstrap.outcome, 'updated');
    const authoritySessionId = randomUUID();
    await identityRepository.createSession({
      authenticatedAt: new Date('2026-08-01T12:31:00.000Z'),
      client: 'web',
      compromisedAt: null,
      consumedTokenHashes: [],
      createdAt: new Date('2026-08-01T12:31:00.000Z'),
      csrfTokenHash: digest(`authority-csrf:${authoritySessionId}`),
      currentTokenHash: digest(`authority-refresh:${authoritySessionId}`),
      expiresAt: new Date('2026-09-01T12:31:00.000Z'),
      id: authoritySessionId,
      idleExpiresAt: new Date('2026-08-02T12:31:00.000Z'),
      ipHash: null,
      lastUsedAt: new Date('2026-08-01T12:31:00.000Z'),
      revokedAt: null,
      userAgent: null,
      userId: adapterTarget.user.id,
    });
    const authorityRequestId = 'integration-request-001';
    const roleChange = await authorityRepository.changePlatformRole({
      actorUserId: adapterActor.user.id,
      event: {
        action: 'platform_role_change',
        actorSessionId: randomUUID(),
        actorUserId: adapterActor.user.id,
        id: randomUUID(),
        occurredAt: new Date('2026-08-01T12:32:00.000Z'),
        operatorReference: null,
        reason: 'Integration role change verifies audit metadata and session revocation.',
        requestId: authorityRequestId,
        source: 'api',
      },
      expectedRevision: adapterTarget.user.authorityRevision,
      platformRole: 'moderator',
      targetUserId: adapterTarget.user.id,
    });
    assert.equal(roleChange.outcome, 'updated');
    assert.equal(roleChange.revokedSessionCount, 1);
    assert.equal(roleChange.auditEvent.requestId, authorityRequestId);
    assert.ok(roleChange.auditEvent.actorSessionId);
    const ownershipTransfer = await authorityRepository.transferOrganizationOwnership({
      actorUserId: adapterActor.user.id,
      event: {
        action: 'organization_ownership_transfer',
        actorSessionId: randomUUID(),
        actorUserId: adapterActor.user.id,
        id: randomUUID(),
        occurredAt: new Date('2026-08-01T12:35:00.000Z'),
        operatorReference: null,
        reason: 'Integration ownership transfer verifies the exact owner invariant.',
        requestId: 'integration-request-002',
        source: 'api',
      },
      expectedRevision: decidedReview.organization.revision,
      organizationId: adapterOrganizationId,
      targetUserId: adapterTarget.user.id,
    });
    assert.equal(ownershipTransfer.outcome, 'updated');
    assert.equal(ownershipTransfer.organization.ownerUserId, adapterTarget.user.id);
    const updatedFormerOwner = await organizationRepository.updateMembership(
      adapterOrganizationId,
      adapterActor.user.id,
      { role: 'analyst' },
    );
    assert.equal(updatedFormerOwner.role, 'analyst');

    const migrationDataset = Object.freeze({ sourceChecksum: 'f'.repeat(64), sourceRecords: 0 });
    const parityReport = await createParityReport(pool, {
      clock: () => new Date('2026-08-01T13:00:00.000Z'),
      datasetSha256: migrationDataset.sourceChecksum,
    });
    assert.equal(parityReport.import.sourceRecords, migrationDataset.sourceRecords);
    assert.equal(parityReport.domains.identity.readyForCutover, false);
    assert.ok(parityReport.domains.identity.quarantined > 0);
    assert.ok(parityReport.domains.challenges.adapterReady === false);
    const signedParity = signParityReport(parityReport, Buffer.alloc(32, 23));
    assert.match(signedParity.reportSha256, /^[a-f0-9]{64}$/);

    const cutoverGeneration = 'integration-generation-001';
    const cutoverReportSha256 = 'd'.repeat(64);
    const rollbackSnapshotSha256 = 'e'.repeat(64);
    const rollbackUntil = new Date('2035-01-01T00:00:00.000Z');
    const cutoverDomains = ['authority', 'identity', 'organizations'];
    const cutoverSafety = {
      datasetSha256: migrationDataset.sourceChecksum,
      deploymentEnvironment: 'test',
      domains: cutoverDomains,
      generation: cutoverGeneration,
      operatorReference: 'integration-change-record',
      parityReportSha256: cutoverReportSha256,
      rollbackSnapshotSha256,
      rollbackUntil,
    };
    await client.query('BEGIN');
    try {
      await activate(client, cutoverSafety);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    const targetDatabase = targetDatabaseName(process.env.DATABASE_URL);
    const runtimePersistence = loadPersistenceRuntimeConfig(
      {
        DATABASE_URL: process.env.DATABASE_URL,
        PERSISTENCE_AUTHORITY_STORE: 'postgres',
        PERSISTENCE_CUTOVER_APPROVAL: `cutover:test:${targetDatabase}:${cutoverGeneration}:${cutoverReportSha256}:${cutoverDomains.join(',')}`,
        PERSISTENCE_CUTOVER_GENERATION: cutoverGeneration,
        PERSISTENCE_ENVIRONMENT: 'test',
        PERSISTENCE_IDENTITY_STORE: 'postgres',
        PERSISTENCE_LEGACY_API_MODE: 'disabled',
        PERSISTENCE_MIGRATION_DATASET_SHA256: migrationDataset.sourceChecksum,
        PERSISTENCE_ORGANIZATIONS_STORE: 'postgres',
        PERSISTENCE_PARITY_REPORT_SHA256: cutoverReportSha256,
        PERSISTENCE_ROLLBACK_REHEARSED: 'true',
        PERSISTENCE_ROLLBACK_SNAPSHOT_SHA256: rollbackSnapshotSha256,
        PERSISTENCE_ROLLBACK_UNTIL: rollbackUntil.toISOString(),
        PERSISTENCE_WRITE_FREEZE_CONFIRMED: 'true',
      },
      { nodeEnv: 'test', now: () => new Date('2030-01-01T00:00:00.000Z') },
    );
    await verifyPersistenceActivation(pool, runtimePersistence);
    await client.query('BEGIN');
    try {
      await rollback(client, cutoverSafety);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    await assert.rejects(
      verifyPersistenceActivation(pool, runtimePersistence),
      /activation record does not match/,
    );
    const cutoverFlags = await client.query(
      `SELECT value->>'store' AS store, value->>'state' AS state
         FROM feature_flags
        WHERE environment = 'test' AND key = ANY($1::text[])
        ORDER BY key`,
      [cutoverDomains.map((domain) => `persistence.${domain}.store`)],
    );
    assert.equal(cutoverFlags.rowCount, 3);
    assert.ok(
      cutoverFlags.rows.every((row) => row.store === 'postgres'),
    );

    process.stdout.write(
      `${JSON.stringify({
        auditAppendOnly: true,
        authorizationSeed: catalogCounts.rows[0],
        fileLifecycle: true,
        fileReconciliation: { clean: true, orphanBlocked: true },
        migration: migrations.rows.map((row) => row.migration_name),
        normalizedImport: null,
        persistenceCutover: {
          activated: true,
          domains: cutoverDomains,
          rolledBack: true,
        },
        postgresRuntimeAdapters: {
          authorityAuditMetadata: true,
          identityRotationAndReuse: true,
          organizationTransactions: true,
        },
        reconciliation: {
          authenticated: true,
          fixtureCutoverReady: false,
          reportSha256: signedParity.reportSha256,
        },
        organizationOwnerInvariant: true,
        partialUniqueConstraints: true,
        tables: tableCount.rows[0].count,
      })}\n`,
    );
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(`Database integration test failed: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
