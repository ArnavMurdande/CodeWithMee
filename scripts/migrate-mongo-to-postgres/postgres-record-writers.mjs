import { sha256, sourceIdentifier, stableStringify } from './canonical-json.mjs';
import { migrationChildId, migrationTargetId } from './target-identifiers.mjs';

const PASSWORD_HASH = /^\$(?:2[aby]|argon2id)\$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class ImportRecordError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = 'ImportRecordError';
  }
}

/** @param {unknown} value */
function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

/** @param {unknown} value @param {number} maximum @param {string} fallback */
function textValue(value, maximum, fallback = '') {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return (normalized || fallback).slice(0, maximum);
}

/** @param {unknown} value @param {number} fallback @param {number} minimum @param {number} maximum */
function integerValue(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)));
}

/** @param {unknown} value @param {Date} fallback */
function dateValue(value, fallback) {
  /** @type {any} */
  const objectValue = value;
  const candidate =
    value && typeof value === 'object' && typeof objectValue.$date === 'string'
      ? objectValue.$date
      : value;
  const parsed = new Date(
    typeof candidate === 'string' || typeof candidate === 'number' ? candidate : NaN,
  );
  return Number.isNaN(parsed.getTime()) ? new Date(fallback) : parsed;
}

/** @param {unknown} value */
function nullableDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = dateValue(value, new Date(NaN));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** @param {unknown} value */
function normalizedEmail(value) {
  const email = textValue(value, 320).toLowerCase();
  return EMAIL_PATTERN.test(email) ? email : null;
}

/** @param {unknown} value @param {string} fallback */
function slugValue(value, fallback) {
  const slug = textValue(value, 200)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || fallback;
}

/** @param {unknown} value */
function sourceId(value) {
  return sourceIdentifier(value);
}

/** @param {any} context @param {string} collection @param {unknown} reference @param {string} target */
function requiredTarget(context, collection, reference, target) {
  const identifier = sourceId(reference);
  if (!identifier || !context.plannedSources.has(`${collection}:${identifier}`)) {
    throw new ImportRecordError(
      'parent_source_not_importable',
      'A required parent source record is quarantined or absent.',
    );
  }
  return migrationTargetId(collection, identifier, target);
}

/** @param {any} context @param {unknown} reference */
function optionalUserTarget(context, reference) {
  const identifier = sourceId(reference);
  return identifier && context.plannedSources.has(`users:${identifier}`)
    ? migrationTargetId('users', identifier, 'user')
    : null;
}

/** @param {unknown} value */
function supportedPasswordHash(value) {
  return typeof value === 'string' && PASSWORD_HASH.test(value);
}

/** @param {any} client @param {string} sql @param {unknown[]} values */
async function query(client, sql, values = []) {
  return client.query(sql, values);
}

/** @param {unknown} value */
function publicRole(value) {
  return ['learner', 'moderator', 'support', 'superadmin'].includes(String(value))
    ? String(value)
    : 'learner';
}

/** @param {unknown} value @param {boolean} banned */
function userStatus(value, banned) {
  if (banned) return 'banned';
  return ['active', 'suspended', 'banned', 'deletion_pending'].includes(String(value))
    ? String(value)
    : 'active';
}

/** @param {any} context @param {any} document */
function resolveAuthor(context, document) {
  const authorType = document.authorType === 'Company' ? 'Company' : 'User';
  if (authorType === 'Company') {
    return {
      organizationId: requiredTarget(context, 'companies', document.author, 'organization_claim'),
      userId: null,
    };
  }
  return {
    organizationId: null,
    userId: requiredTarget(context, 'users', document.author, 'user'),
  };
}

/** @param {any} client @param {any} context @param {string} sourceUserId @param {any} document */
async function writeSocialGraph(client, context, sourceUserId, document) {
  const userId = migrationTargetId('users', sourceUserId, 'user');
  /** @param {unknown} reference @param {string} status @param {boolean} incoming */
  const relationship = async (reference, status, incoming) => {
    const other = optionalUserTarget(context, reference);
    if (!other || other === userId) return;
    const source = incoming ? other : userId;
    const target = incoming ? userId : other;
    await query(
      client,
      `INSERT INTO social_relationships (source_user_id, target_user_id, status)
       VALUES ($1, $2, $3::social_relationship_status)
       ON CONFLICT (source_user_id, target_user_id) DO UPDATE
       SET status = CASE
         WHEN social_relationships.status = 'following' THEN 'following'::social_relationship_status
         ELSE EXCLUDED.status
       END,
       updated_at = now()`,
      [source, target, status],
    );
  };
  for (const reference of arrayValue(document.following)) {
    await relationship(reference, 'following', false);
  }
  for (const reference of arrayValue(document.followers)) {
    await relationship(reference, 'following', true);
  }
  for (const reference of arrayValue(document.pendingFollowRequests)) {
    await relationship(reference, 'requested', true);
  }
  for (const reference of arrayValue(document.sentFollowRequests)) {
    await relationship(reference, 'requested', false);
  }
  for (const reference of arrayValue(document.blockedUsers)) {
    const blocked = optionalUserTarget(context, reference);
    if (!blocked || blocked === userId) continue;
    await query(
      client,
      `INSERT INTO user_blocks (blocker_user_id, blocked_user_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [userId, blocked],
    );
  }
}

/** @param {any} client @param {any} context @param {string} sourceUserId @param {any} document */
async function writeLearningChildren(client, context, sourceUserId, document) {
  const userId = migrationTargetId('users', sourceUserId, 'user');
  await query(
    client,
    `INSERT INTO learning_profiles
     (user_id, score, points, theme_preferences, created_at, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
    [
      userId,
      integerValue(document.score, 0, 0, 2_147_483_647),
      integerValue(document.points, 0, 0, 2_147_483_647),
      JSON.stringify(document.themePreferences || {}),
      dateValue(document.createdAt, context.clock()),
      dateValue(document.updatedAt, context.clock()),
    ],
  );
  await query(
    client,
    `INSERT INTO social_profiles (user_id, privacy_settings, created_at, updated_at)
     VALUES ($1, $2::jsonb, $3, $4)`,
    [
      userId,
      JSON.stringify(document.privacySettings || {}),
      dateValue(document.createdAt, context.clock()),
      dateValue(document.updatedAt, context.clock()),
    ],
  );

  for (const [roadmapIndex, roadmap] of arrayValue(document.roadmaps).entries()) {
    const roadmapId = migrationChildId('users', sourceUserId, 'roadmap', roadmapIndex);
    await query(
      client,
      `INSERT INTO learning_roadmaps
       (id, user_id, title, position, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        roadmapId,
        userId,
        textValue(roadmap?.title, 200, `Roadmap ${roadmapIndex + 1}`),
        roadmapIndex,
        dateValue(document.createdAt, context.clock()),
        dateValue(document.updatedAt, context.clock()),
      ],
    );
    for (const [topicIndex, topic] of arrayValue(roadmap?.topics).entries()) {
      await query(
        client,
        `INSERT INTO learning_topics
         (id, roadmap_id, title, description, youtube_query, completed, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          migrationChildId('users', sourceUserId, 'roadmap_topic', roadmapIndex, topicIndex),
          roadmapId,
          textValue(topic?.topic, 200, `Topic ${topicIndex + 1}`),
          textValue(topic?.description, 100_000) || null,
          textValue(topic?.youtube_query, 500) || null,
          Boolean(topic?.completed),
          topicIndex,
        ],
      );
    }
  }

  const conversations = [
    ...arrayValue(document.conversations).map((entry) => ({ ...entry, context: 'general' })),
    ...arrayValue(document.sandboxConversations).map((entry) => ({
      ...entry,
      context: 'sandbox',
    })),
  ];
  for (const [index, conversation] of conversations.entries()) {
    if (
      !textValue(conversation?.prompt, 1_000_000) ||
      !textValue(conversation?.response, 1_000_000)
    ) {
      continue;
    }
    await query(
      client,
      `INSERT INTO learning_conversations
       (id, user_id, context, pathway, chapter, prompt, response, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        migrationChildId('users', sourceUserId, 'conversation', index),
        userId,
        conversation.context,
        textValue(conversation.pathway, 200) || null,
        textValue(conversation.chapter, 200) || null,
        String(conversation.prompt),
        String(conversation.response),
        dateValue(conversation.timestamp, context.clock()),
      ],
    );
  }

  for (const [noteIndex, note] of arrayValue(document.notes).entries()) {
    const noteId = migrationChildId('users', sourceUserId, 'note', noteIndex);
    await query(
      client,
      `INSERT INTO learning_notes
       (id, user_id, title, content, formatting, canvas_data, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
      [
        noteId,
        userId,
        textValue(note?.title, 255, 'Untitled Note'),
        typeof note?.content === 'string' ? note.content : '',
        JSON.stringify(note?.formatting || {}),
        typeof note?.canvasData === 'string' ? note.canvasData : null,
        dateValue(note?.createdAt, context.clock()),
        dateValue(note?.updatedAt, context.clock()),
      ],
    );
    for (const [attachmentIndex, attachment] of arrayValue(note?.attachments).entries()) {
      const legacyUrl = textValue(attachment?.url, 2048);
      if (!legacyUrl) continue;
      const kind = ['image', 'audio', 'video', 'document', 'text'].includes(attachment?.fileType)
        ? attachment.fileType
        : 'document';
      await query(
        client,
        `INSERT INTO learning_note_attachments
         (id, note_id, kind, legacy_url, original_name, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          migrationChildId('users', sourceUserId, 'note_attachment', noteIndex, attachmentIndex),
          noteId,
          kind,
          legacyUrl,
          textValue(attachment?.name, 255) || null,
          dateValue(attachment?.uploadedAt, context.clock()),
        ],
      );
    }
  }

  for (const [index, progress] of arrayValue(document.videoProgress).entries()) {
    const videoSourceKey = textValue(progress?.videoId, 500);
    if (!videoSourceKey) continue;
    const duration = integerValue(progress?.duration, 0, 0, 2_147_483_647);
    const position = integerValue(progress?.timestamp, 0, 0, duration || 2_147_483_647);
    await query(
      client,
      `INSERT INTO video_progress
       (id, user_id, video_source_key, position_seconds, duration_seconds, topic, pathway, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (user_id, video_source_key) DO UPDATE
       SET position_seconds = GREATEST(video_progress.position_seconds, EXCLUDED.position_seconds),
           duration_seconds = GREATEST(video_progress.duration_seconds, EXCLUDED.duration_seconds),
           topic = COALESCE(EXCLUDED.topic, video_progress.topic),
           pathway = COALESCE(EXCLUDED.pathway, video_progress.pathway),
           updated_at = GREATEST(video_progress.updated_at, EXCLUDED.updated_at)`,
      [
        migrationChildId('users', sourceUserId, 'video_progress', index),
        userId,
        videoSourceKey,
        position,
        duration,
        textValue(progress?.topic, 200) || null,
        textValue(progress?.pathway, 200) || null,
        dateValue(progress?.updatedAt, context.clock()),
      ],
    );
  }

  for (const [index, simulation] of arrayValue(document.jobSims).entries()) {
    await query(
      client,
      `INSERT INTO job_simulation_progress (id, user_id, title, progress, position)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        migrationChildId('users', sourceUserId, 'job_simulation', index),
        userId,
        textValue(simulation?.title, 200, `Simulation ${index + 1}`),
        integerValue(simulation?.progress, 0, 0, 100),
        index,
      ],
    );
  }
}

/** @param {any} client @param {any} document @param {any} context */
async function writeUser(client, document, context) {
  const sourceUserId = sourceId(document._id);
  const email = normalizedEmail(document.email);
  if (!sourceUserId || !email) {
    throw new ImportRecordError('invalid_user_identity', 'User identity validation failed.');
  }
  const targetId = migrationTargetId('users', sourceUserId, 'user');
  const createdAt = dateValue(document.createdAt, context.clock());
  const updatedAt = dateValue(document.updatedAt, context.clock());
  const displayName = textValue(
    document.displayName || document.username,
    120,
    email.split('@')[0],
  );
  await query(
    client,
    `INSERT INTO users
     (id, email_normalized, email_display, display_name, username, status, platform_role,
      authority_revision, email_verified_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6::user_status, $7::platform_role, $8, $9, $10, $11)`,
    [
      targetId,
      email,
      textValue(document.email, 320, email),
      displayName,
      textValue(document.username, 64) || null,
      userStatus(document.status, Boolean(document.isBanned)),
      publicRole(document.platformRole || document.role),
      integerValue(document.authorityRevision, 1, 1, 2_147_483_647),
      nullableDate(document.emailVerifiedAt),
      createdAt,
      updatedAt,
    ],
  );
  await writeLearningChildren(client, context, sourceUserId, document);
  await writeSocialGraph(client, context, sourceUserId, document);

  const warnings = [];
  if (document.profilePictureUrl) warnings.push('legacy_profile_media_requires_file_mapping');
  if (document.resetPasswordToken || document.resetPasswordExpire) {
    warnings.push('legacy_reset_token_discarded');
  }
  if (!context.authIdentitySourceUsers.has(sourceUserId)) {
    if (document.authMethod === 'local' && supportedPasswordHash(document.password)) {
      await query(
        client,
        `INSERT INTO auth_identities
         (id, user_id, provider, provider_subject, password_hash, created_at, updated_at)
         VALUES ($1, $2, 'local', $3, $4, $5, $6)`,
        [
          migrationTargetId('users', sourceUserId, 'auth_identity'),
          targetId,
          email,
          document.password,
          createdAt,
          updatedAt,
        ],
      );
    } else if (document.authMethod === 'google') {
      warnings.push('google_identity_relink_required');
    } else {
      warnings.push('credential_reset_required');
    }
  }
  return { targetId, targetType: 'user', warnings };
}

/** @param {any} client @param {any} document @param {any} context */
async function writeAuthIdentity(client, document, context) {
  const recordId = sourceId(document._id);
  const sourceUserId = sourceId(document.user);
  if (!recordId || !sourceUserId) {
    throw new ImportRecordError('invalid_auth_identity', 'Identity source fields are missing.');
  }
  const userId = requiredTarget(context, 'users', sourceUserId, 'user');
  const provider = document.provider === 'google' ? 'google' : 'local';
  const providerSubject = textValue(document.providerSubject, 320);
  if (!providerSubject || (provider === 'local' && !supportedPasswordHash(document.passwordHash))) {
    throw new ImportRecordError('invalid_auth_identity', 'Identity cannot be imported safely.');
  }
  if (provider === 'google' && document.passwordHash) {
    throw new ImportRecordError(
      'invalid_auth_identity',
      'Google identity contains credential data.',
    );
  }
  const targetId = migrationTargetId('authidentities', recordId, 'auth_identity');
  await query(
    client,
    `INSERT INTO auth_identities
     (id, user_id, provider, provider_subject, password_hash, created_at, updated_at)
     VALUES ($1, $2, $3::identity_provider, $4, $5, $6, $7)`,
    [
      targetId,
      userId,
      provider,
      providerSubject,
      provider === 'local' ? document.passwordHash : null,
      dateValue(document.createdAt, context.clock()),
      dateValue(document.updatedAt, context.clock()),
    ],
  );
  return { targetId, targetType: 'auth_identity', warnings: [] };
}

/** @param {any} _client @param {any} document @param {any} _context */
async function skipSession(_client, document, _context) {
  return {
    state: 'skipped',
    targetId: null,
    targetType: null,
    warnings: [
      document?.currentTokenHash ? 'sessions_invalidated_at_cutover' : 'invalid_session_discarded',
    ],
  };
}

/** @param {any} _client @param {any} _document @param {any} _context */
async function skipOneTimeToken(_client, _document, _context) {
  return {
    state: 'skipped',
    targetId: null,
    targetType: null,
    warnings: ['one_time_token_discarded'],
  };
}

/** @param {any} client @param {string} organizationId @param {string} ownerId @param {string} membershipId @param {Date} joinedAt */
async function insertOrganizationOwner(client, organizationId, ownerId, membershipId, joinedAt) {
  await query(
    client,
    `INSERT INTO organization_memberships
     (id, organization_id, user_id, role, status, joined_at, revision, created_at, updated_at)
     VALUES ($1, $2, $3, 'owner', 'active', $4, 1, $4, $4)`,
    [membershipId, organizationId, ownerId, joinedAt],
  );
}

/** @param {any} client @param {any} document @param {any} context */
async function writeOrganization(client, document, context) {
  const identifier = sourceId(document._id);
  if (!identifier)
    throw new ImportRecordError('invalid_organization', 'Organization ID is missing.');
  const ownerId = requiredTarget(context, 'users', document.owner, 'user');
  const targetId = migrationTargetId('organizations', identifier, 'organization');
  const createdAt = dateValue(document.createdAt, context.clock());
  const status = ['draft', 'pending_review', 'approved', 'rejected', 'suspended'].includes(
    document.verificationStatus,
  )
    ? document.verificationStatus
    : 'draft';
  await query(
    client,
    `INSERT INTO organizations
     (id, slug, name, description, industry, owner_user_id, verification_status,
      revision, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::organization_verification_status, $8, $9, $10)`,
    [
      targetId,
      slugValue(document.slug, `org-${targetId.slice(0, 12)}`),
      textValue(document.name, 160, 'Imported organization'),
      textValue(document.description, 2000) || null,
      textValue(document.industry, 120) || null,
      ownerId,
      status,
      integerValue(document.revision, 1, 1, 2_147_483_647),
      createdAt,
      dateValue(document.updatedAt, createdAt),
    ],
  );
  await insertOrganizationOwner(
    client,
    targetId,
    ownerId,
    migrationChildId('organizations', identifier, 'owner_membership'),
    createdAt,
  );
  return {
    targetId,
    targetType: 'organization',
    warnings: document.logoFile ? ['legacy_organization_logo_requires_file_mapping'] : [],
  };
}

/** @param {any} client @param {any} document @param {any} context */
async function writeOrganizationMembership(client, document, context) {
  const identifier = sourceId(document._id);
  const organizationSourceId = sourceId(document.organization);
  const userSourceId = sourceId(document.user);
  if (!identifier || !organizationSourceId || !userSourceId) {
    throw new ImportRecordError('invalid_membership', 'Membership source fields are missing.');
  }
  const organizationId = requiredTarget(
    context,
    'organizations',
    organizationSourceId,
    'organization',
  );
  const userId = requiredTarget(context, 'users', userSourceId, 'user');
  const owner = await query(client, 'SELECT owner_user_id FROM organizations WHERE id = $1', [
    organizationId,
  ]);
  if (owner.rowCount !== 1) {
    throw new ImportRecordError('parent_target_missing', 'Organization target is unavailable.');
  }
  if (document.role === 'owner') {
    if (owner.rows[0].owner_user_id !== userId) {
      throw new ImportRecordError('owner_membership_mismatch', 'Owner membership is inconsistent.');
    }
    return {
      targetId: migrationChildId('organizations', organizationSourceId, 'owner_membership'),
      targetType: 'organization_membership',
      warnings: [],
    };
  }
  const role = ['admin', 'instructor', 'grader', 'analyst'].includes(document.role)
    ? document.role
    : 'analyst';
  const status = ['active', 'suspended', 'revoked'].includes(document.status)
    ? document.status
    : 'active';
  const targetId = migrationTargetId(
    'organizationmemberships',
    identifier,
    'organization_membership',
  );
  await query(
    client,
    `INSERT INTO organization_memberships
     (id, organization_id, user_id, role, status, invited_by_user_id, joined_at,
      suspended_at, revoked_at, revision, created_at, updated_at)
     VALUES ($1, $2, $3, $4::organization_role, $5::membership_status, $6, $7,
             CASE WHEN $5 = 'suspended' THEN $8 ELSE NULL END,
             CASE WHEN $5 = 'revoked' THEN $8 ELSE NULL END, 1, $7, $8)`,
    [
      targetId,
      organizationId,
      userId,
      role,
      status,
      optionalUserTarget(context, document.invitedBy),
      dateValue(document.joinedAt || document.createdAt, context.clock()),
      dateValue(document.updatedAt, context.clock()),
    ],
  );
  return { targetId, targetType: 'organization_membership', warnings: [] };
}

/** @param {any} _client @param {any} _document @param {any} _context */
async function skipInvitation(_client, _document, _context) {
  return {
    state: 'skipped',
    targetId: null,
    targetType: null,
    warnings: ['pending_invitation_discarded_and_must_be_reissued'],
  };
}

/** @param {any} client @param {any} document @param {any} context */
async function writeProviderReview(client, document, context) {
  const identifier = sourceId(document._id);
  if (!identifier) throw new ImportRecordError('invalid_provider_review', 'Review ID is missing.');
  const organizationId = requiredTarget(
    context,
    'organizations',
    document.organization,
    'organization',
  );
  const submittedBy = requiredTarget(context, 'users', document.submittedBy, 'user');
  const status = ['pending_review', 'approved', 'rejected'].includes(document.status)
    ? document.status
    : 'pending_review';
  const reviewer = optionalUserTarget(context, document.reviewer);
  const reviewedAt = nullableDate(document.reviewedAt);
  if (status !== 'pending_review' && (!reviewer || !reviewedAt)) {
    throw new ImportRecordError(
      'incomplete_provider_decision',
      'Completed provider review lacks reviewer evidence.',
    );
  }
  const targetId = migrationTargetId(
    'providerverificationreviews',
    identifier,
    'provider_verification_review',
  );
  await query(
    client,
    `INSERT INTO provider_verification_reviews
     (id, organization_id, submitted_by_user_id, reviewer_user_id, status, statement,
      decision_reason, submitted_at, reviewed_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5::verification_review_status, $6, $7, $8, $9, $10, $11)`,
    [
      targetId,
      organizationId,
      submittedBy,
      reviewer,
      status,
      textValue(document.statement, 2000, 'Imported provider verification statement'),
      status === 'rejected'
        ? textValue(document.decisionReason, 2000, 'Imported rejection requires review.')
        : textValue(document.decisionReason, 2000) || null,
      dateValue(document.submittedAt, context.clock()),
      reviewedAt,
      dateValue(document.createdAt, context.clock()),
      dateValue(document.updatedAt, context.clock()),
    ],
  );
  return {
    targetId,
    targetType: 'provider_verification_review',
    warnings: arrayValue(document.evidence).length
      ? ['legacy_verification_evidence_requires_file_mapping']
      : [],
  };
}

/** @param {any} client @param {any} document @param {any} _context */
async function writeAuthorityControl(client, document, _context) {
  const key = textValue(document.controlKey, 120);
  if (!['platform_authority', 'superadmin_bootstrap_v1'].includes(key)) {
    throw new ImportRecordError('unknown_authority_control', 'Authority control key is unknown.');
  }
  await query(
    client,
    `UPDATE authority_controls
     SET revision = GREATEST(revision, $2), updated_at = now()
     WHERE key = $1`,
    [key, integerValue(document.revision, 0, 0, 2_147_483_647)],
  );
  return { targetId: key, targetType: 'authority_control', warnings: [] };
}

/** @param {unknown} value */
function authorityState(value) {
  if (!value || typeof value !== 'object') return {};
  /** @type {Record<string, unknown>} */
  const output = {};
  /** @type {any} */
  const input = value;
  for (const key of [
    'authorityRevision',
    'organizationRole',
    'ownerUserId',
    'platformRole',
    'status',
  ]) {
    if (input[key] !== undefined) output[key] = input[key];
  }
  return output;
}

/** @param {any} client @param {any} document @param {any} context */
async function writeAuthorityAudit(client, document, context) {
  const identifier = sourceId(document._id);
  const targetSourceId = sourceId(document.targetUserId);
  if (!identifier || !targetSourceId) {
    throw new ImportRecordError('invalid_authority_audit', 'Audit target is missing.');
  }
  const targetUserId = requiredTarget(context, 'users', targetSourceId, 'user');
  const targetId = migrationTargetId('authority_audit_events', identifier, 'audit_event');
  await query(
    client,
    `INSERT INTO audit_events
     (id, actor_user_id, organization_id, action, target_type, target_id, correlation_id,
      reason, source, operator_ref, before_state, after_state, operation_key, occurred_at,
      created_at)
     VALUES ($1, NULL, NULL, $2, 'user', $3, NULL, $4, 'migration', 'p0c-s4-import',
             $5::jsonb, $6::jsonb, NULL, $7, $7)`,
    [
      targetId,
      textValue(document.action, 160, 'legacy_authority_event'),
      targetUserId,
      'Imported legacy authority event; original reason remains in the protected source snapshot.',
      JSON.stringify(authorityState(document.beforeState)),
      JSON.stringify(authorityState(document.afterState)),
      dateValue(document.occurredAt, context.clock()),
    ],
  );
  return {
    targetId,
    targetType: 'audit_event',
    warnings: ['authority_reason_redacted_during_import'],
  };
}

/** @param {any} client @param {any} document @param {any} context */
async function writeCompany(client, document, context) {
  const identifier = sourceId(document._id);
  const email = normalizedEmail(document.adminEmail);
  const ownerSourceId = email ? context.userSourceByEmail.get(email) : null;
  if (!identifier || !ownerSourceId) {
    throw new ImportRecordError(
      'company_owner_claim_missing',
      'Company owner claim is unresolved.',
    );
  }
  const ownerId = requiredTarget(context, 'users', ownerSourceId, 'user');
  const targetId = migrationTargetId('companies', identifier, 'organization_claim');
  const createdAt = dateValue(document.createdAt, context.clock());
  await query(
    client,
    `INSERT INTO organizations
     (id, slug, name, description, industry, owner_user_id, verification_status,
      revision, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::organization_verification_status, 1, $8, $8)`,
    [
      targetId,
      slugValue(document.companyId, `company-${targetId.slice(0, 12)}`),
      textValue(document.companyName, 160, 'Imported provider'),
      textValue(document.description, 2000) || null,
      textValue(document.industry, 120) || null,
      ownerId,
      document.status === 'approved' ? 'approved' : 'pending_review',
      createdAt,
    ],
  );
  await insertOrganizationOwner(
    client,
    targetId,
    ownerId,
    migrationChildId('companies', identifier, 'owner_membership'),
    createdAt,
  );
  const warnings = ['legacy_company_credential_discarded'];
  if (document.logo) warnings.push('legacy_company_logo_requires_file_mapping');
  return { targetId, targetType: 'organization_claim', warnings };
}

/** @param {any} client @param {any} document @param {any} context */
async function writeCompanyEmployee(client, document, context) {
  if (document.role !== 'admin') {
    return {
      state: 'skipped',
      targetId: null,
      targetType: null,
      warnings: ['legacy_employee_membership_requires_learner_enrollment_review'],
    };
  }
  const identifier = sourceId(document._id);
  if (!identifier)
    throw new ImportRecordError('invalid_company_employee', 'Employee ID is missing.');
  const organizationId = requiredTarget(
    context,
    'companies',
    document.company,
    'organization_claim',
  );
  const userId = requiredTarget(context, 'users', document.user, 'user');
  const owner = await query(client, 'SELECT owner_user_id FROM organizations WHERE id = $1', [
    organizationId,
  ]);
  if (owner.rowCount !== 1) {
    throw new ImportRecordError('parent_target_missing', 'Company target is unavailable.');
  }
  if (owner.rows[0].owner_user_id === userId) {
    return {
      targetId: migrationChildId('companies', sourceId(document.company), 'owner_membership'),
      targetType: 'organization_membership_legacy',
      warnings: ['legacy_employee_identifier_discarded'],
    };
  }
  const targetId = migrationTargetId(
    'companyemployees',
    identifier,
    'organization_membership_legacy',
  );
  await query(
    client,
    `INSERT INTO organization_memberships
     (id, organization_id, user_id, role, status, joined_at, revision, created_at, updated_at)
     VALUES ($1, $2, $3, 'admin', $4::membership_status, $5, 1, $5, $5)`,
    [
      targetId,
      organizationId,
      userId,
      document.status === 'inactive' ? 'suspended' : 'active',
      dateValue(document.addedAt, context.clock()),
    ],
  );
  return {
    targetId,
    targetType: 'organization_membership_legacy',
    warnings: ['legacy_employee_identifier_discarded'],
  };
}

/** @param {any} client @param {any} context @param {string} challengeId @param {string} sourceChallengeId @param {any[]} comments @param {string | null} parentId @param {number[]} path */
async function writeChallengeComments(
  client,
  context,
  challengeId,
  sourceChallengeId,
  comments,
  parentId,
  path,
) {
  for (const [index, comment] of comments.entries()) {
    const commentPath = [...path, index];
    const commentId = migrationChildId('challenges', sourceChallengeId, 'comment', ...commentPath);
    const authorId = requiredTarget(context, 'users', comment?.author, 'user');
    const text = textValue(comment?.text, 1_000_000);
    if (!text) throw new ImportRecordError('invalid_challenge_comment', 'Comment body is empty.');
    await query(
      client,
      `INSERT INTO challenge_comments
       (id, challenge_id, parent_id, author_user_id, text, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        commentId,
        challengeId,
        parentId,
        authorId,
        text,
        dateValue(comment?.createdAt, context.clock()),
      ],
    );
    for (const reference of arrayValue(comment?.likes)) {
      const userId = optionalUserTarget(context, reference);
      if (userId) {
        await query(
          client,
          `INSERT INTO challenge_comment_reactions (comment_id, user_id, kind)
           VALUES ($1, $2, 'like') ON CONFLICT DO NOTHING`,
          [commentId, userId],
        );
      }
    }
    for (const reference of arrayValue(comment?.dislikes)) {
      const userId = optionalUserTarget(context, reference);
      if (userId) {
        await query(
          client,
          `INSERT INTO challenge_comment_reactions (comment_id, user_id, kind)
           VALUES ($1, $2, 'dislike') ON CONFLICT DO NOTHING`,
          [commentId, userId],
        );
      }
    }
    for (const award of arrayValue(comment?.awards)) {
      const userId = optionalUserTarget(context, award?.user);
      if (userId) {
        await query(
          client,
          `INSERT INTO challenge_comment_reactions
           (comment_id, user_id, kind, award_type, created_at)
           VALUES ($1, $2, 'award', $3, $4) ON CONFLICT DO NOTHING`,
          [
            commentId,
            userId,
            textValue(award?.type, 32, 'star'),
            dateValue(award?.createdAt, context.clock()),
          ],
        );
      }
    }
    await writeChallengeComments(
      client,
      context,
      challengeId,
      sourceChallengeId,
      arrayValue(comment?.replies),
      commentId,
      commentPath,
    );
  }
}

/** @param {any} client @param {any} document @param {any} context */
async function writeChallenge(client, document, context) {
  const identifier = sourceId(document._id);
  if (!identifier) throw new ImportRecordError('invalid_challenge', 'Challenge ID is missing.');
  /** @type {Record<string, string>} */
  const difficultyMap = { Easy: 'easy', Hard: 'hard', Medium: 'medium' };
  const difficulty = difficultyMap[document.difficulty];
  const score = Number(document.score);
  if (!difficulty || !Number.isInteger(score) || score < 1 || score > 10) {
    throw new ImportRecordError(
      'invalid_challenge_contract',
      'Challenge difficulty or score is invalid.',
    );
  }
  const targetId = migrationTargetId('challenges', identifier, 'challenge');
  const versionId = migrationTargetId('challenges', identifier, 'challenge_version');
  const authorId = requiredTarget(context, 'users', document.author, 'user');
  const successful = integerValue(document.successfulAttempts, 0, 0, 2_147_483_647);
  const total = integerValue(document.totalAttempts, successful, successful, 2_147_483_647);
  await query(
    client,
    `INSERT INTO challenges
     (id, title, difficulty, tags, score, created_by_user_id, legacy_successful_attempts,
      legacy_total_attempts, created_at, updated_at)
     VALUES ($1, $2, $3::challenge_difficulty, $4::jsonb, $5, $6, $7, $8, $9, $9)`,
    [
      targetId,
      textValue(document.title, 255, 'Imported challenge'),
      difficulty,
      JSON.stringify(
        arrayValue(document.tags)
          .filter((tag) => typeof tag === 'string')
          .map((tag) => tag.trim().slice(0, 80))
          .filter(Boolean),
      ),
      score,
      authorId,
      successful,
      total,
      dateValue(document.createdAt, context.clock()),
    ],
  );
  await query(
    client,
    `INSERT INTO challenge_versions
     (id, challenge_id, version, statement, constraints_text, reference_solution, created_at)
     VALUES ($1, $2, 1, $3, $4, $5, $6)`,
    [
      versionId,
      targetId,
      typeof document.description === 'string' ? document.description : '',
      typeof document.constraints === 'string' ? document.constraints : null,
      typeof document.solution === 'string' ? document.solution : '',
      dateValue(document.createdAt, context.clock()),
    ],
  );
  for (const [index, testCase] of arrayValue(document.testCases).entries()) {
    await query(
      client,
      `INSERT INTO challenge_test_cases
       (id, version_id, position, input, expected_output, visibility)
       VALUES ($1, $2, $3, $4, $5, 'visible')`,
      [
        migrationTargetId('challenges', identifier, `challenge_test_case:${index}`),
        versionId,
        index,
        typeof testCase?.input === 'string' ? testCase.input : '',
        typeof testCase?.output === 'string' ? testCase.output : '',
      ],
    );
  }
  for (const reference of arrayValue(document.likes)) {
    const userId = optionalUserTarget(context, reference);
    if (userId) {
      await query(
        client,
        `INSERT INTO challenge_reactions (challenge_id, user_id, kind)
         VALUES ($1, $2, 'like')
         ON CONFLICT (challenge_id, user_id) DO UPDATE SET kind = EXCLUDED.kind`,
        [targetId, userId],
      );
    }
  }
  for (const reference of arrayValue(document.dislikes)) {
    const userId = optionalUserTarget(context, reference);
    if (userId) {
      await query(
        client,
        `INSERT INTO challenge_reactions (challenge_id, user_id, kind)
         VALUES ($1, $2, 'dislike')
         ON CONFLICT (challenge_id, user_id) DO UPDATE SET kind = EXCLUDED.kind`,
        [targetId, userId],
      );
    }
  }
  await writeChallengeComments(
    client,
    context,
    targetId,
    identifier,
    arrayValue(document.comments),
    null,
    [],
  );
  return {
    targetId,
    targetType: 'challenge',
    warnings: arrayValue(document.testCases).length ? ['legacy_tests_forced_visible'] : [],
  };
}

/** @param {any} client @param {any} document @param {any} context */
async function writeCourse(client, document, context) {
  const identifier = sourceId(document._id);
  if (!identifier) throw new ImportRecordError('invalid_course', 'Course ID is missing.');
  if (document.pricing === 'paid' && Number(document.price || 0) > 0) {
    throw new ImportRecordError(
      'paid_course_currency_missing',
      'Paid course currency requires operator review.',
    );
  }
  const organizationId = requiredTarget(
    context,
    'companies',
    document.company,
    'organization_claim',
  );
  const targetId = migrationTargetId('courses', identifier, 'course');
  const versionId = migrationTargetId('courses', identifier, 'course_version');
  const createdAt = dateValue(document.createdAt, context.clock());
  await query(
    client,
    `INSERT INTO courses
     (id, organization_id, title, description, thumbnail_legacy_url, visibility,
      pricing, price_minor, currency, category, tags, active, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6::course_visibility, $7::course_pricing,
             NULL, NULL, $8, $9::jsonb, $10, $11, $12)`,
    [
      targetId,
      organizationId,
      textValue(document.title, 255, 'Imported course'),
      typeof document.description === 'string' ? document.description : null,
      textValue(document.thumbnail, 2048) || null,
      document.visibility === 'private' ? 'private' : 'public',
      'free',
      textValue(document.category, 120) || null,
      JSON.stringify(arrayValue(document.tags).filter((tag) => typeof tag === 'string')),
      document.isActive !== false,
      createdAt,
      dateValue(document.updatedAt, createdAt),
    ],
  );
  await query(
    client,
    `INSERT INTO course_versions (id, course_id, version, created_at)
     VALUES ($1, $2, 1, $3)`,
    [versionId, targetId, createdAt],
  );
  for (const [moduleIndex, module] of arrayValue(document.modules).entries()) {
    const moduleId = migrationChildId('courses', identifier, 'module', moduleIndex);
    await query(
      client,
      `INSERT INTO course_modules (id, version_id, title, description, position)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        moduleId,
        versionId,
        textValue(module?.title, 255, `Module ${moduleIndex + 1}`),
        typeof module?.description === 'string' ? module.description : null,
        moduleIndex,
      ],
    );
    for (const [contentIndex, content] of arrayValue(module?.contents).entries()) {
      const kind = ['video', 'note', 'link', 'resource', 'practice', 'test'].includes(content?.type)
        ? content.type
        : 'note';
      await query(
        client,
        `INSERT INTO course_contents
         (id, module_id, kind, title, legacy_url, body, allow_download, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          migrationChildId('courses', identifier, 'content', moduleIndex, contentIndex),
          moduleId,
          kind,
          textValue(content?.title, 255, `Content ${contentIndex + 1}`),
          textValue(content?.url, 2048) || null,
          typeof content?.content === 'string' ? content.content : null,
          Boolean(content?.allowDownload),
          contentIndex,
        ],
      );
    }
  }
  const warnings = [];
  if (document.thumbnail) warnings.push('legacy_course_thumbnail_requires_file_mapping');
  if (document.certificateTemplateUrl) warnings.push('legacy_certificate_template_requires_review');
  return { targetId, targetType: 'course', warnings };
}

/** @param {any} client @param {any} document @param {any} context */
async function writeEnrollment(client, document, context) {
  const identifier = sourceId(document._id);
  if (!identifier) throw new ImportRecordError('invalid_enrollment', 'Enrollment ID is missing.');
  const userId = requiredTarget(context, 'users', document.user, 'user');
  const courseId = requiredTarget(context, 'courses', document.course, 'course');
  const status = ['enrolled', 'in_progress', 'completed', 'pending_payment'].includes(
    document.status,
  )
    ? document.status
    : 'enrolled';
  const completedAt = nullableDate(document.completedAt);
  if (status === 'completed' && !completedAt) {
    throw new ImportRecordError(
      'invalid_enrollment_completion',
      'Completed enrollment has no completion timestamp.',
    );
  }
  const targetId = migrationTargetId('enrollments', identifier, 'enrollment');
  await query(
    client,
    `INSERT INTO enrollments
     (id, user_id, course_id, status, enrolled_at, completed_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4::enrollment_status, $5, $6, $5, $7)`,
    [
      targetId,
      userId,
      courseId,
      status,
      dateValue(document.enrolledAt, context.clock()),
      completedAt,
      completedAt || dateValue(document.enrolledAt, context.clock()),
    ],
  );
  await query(
    client,
    `INSERT INTO course_progress_import_snapshots
     (enrollment_id, progress_percent, completed_source_ids, authoritative, imported_at)
     VALUES ($1, $2, $3::jsonb, false, $4)`,
    [
      targetId,
      integerValue(document.progressPercent, 0, 0, 100),
      JSON.stringify(
        arrayValue(document.completedContents)
          .map((entry) => sourceId(entry))
          .filter(Boolean)
          .map((entry) => context.fingerprint(entry)),
      ),
      context.clock(),
    ],
  );
  return {
    targetId,
    targetType: 'enrollment',
    warnings: [
      'progress_imported_as_snapshot',
      ...(document.employeeId ? ['legacy_employee_identifier_discarded'] : []),
    ],
  };
}

/** @param {any} client @param {any} context @param {string} postId @param {string} sourcePostId @param {any[]} comments @param {string | null} parentId @param {number[]} path */
async function writeSocialComments(
  client,
  context,
  postId,
  sourcePostId,
  comments,
  parentId,
  path,
) {
  for (const [index, comment] of comments.entries()) {
    const commentPath = [...path, index];
    const commentId = migrationChildId('posts', sourcePostId, 'comment', ...commentPath);
    const author = resolveAuthor(context, comment);
    const content = textValue(comment?.content, 1_000_000);
    if (!content) throw new ImportRecordError('invalid_social_comment', 'Comment body is empty.');
    await query(
      client,
      `INSERT INTO social_comments
       (id, post_id, parent_id, author_user_id, author_organization_id, content, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        commentId,
        postId,
        parentId,
        author.userId,
        author.organizationId,
        content,
        dateValue(comment?.createdAt, context.clock()),
      ],
    );
    for (const [kind, values] of [
      ['like', arrayValue(comment?.likes)],
      ['dislike', arrayValue(comment?.dislikes)],
    ]) {
      for (const reference of values) {
        const userId = optionalUserTarget(context, reference);
        if (userId) {
          await query(
            client,
            `INSERT INTO social_comment_reactions (comment_id, user_id, kind)
             VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
            [commentId, userId, kind],
          );
        }
      }
    }
    for (const reference of arrayValue(comment?.saves)) {
      const userId = optionalUserTarget(context, reference);
      if (userId) {
        await query(
          client,
          `INSERT INTO social_comment_saves (comment_id, user_id)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [commentId, userId],
        );
      }
    }
    for (const award of arrayValue(comment?.awards)) {
      const userId = optionalUserTarget(context, award?.user);
      if (userId) {
        await query(
          client,
          `INSERT INTO social_comment_reactions
           (comment_id, user_id, kind, award_type, created_at)
           VALUES ($1, $2, 'award', $3, $4) ON CONFLICT DO NOTHING`,
          [
            commentId,
            userId,
            textValue(award?.type, 32, 'star'),
            dateValue(award?.createdAt, context.clock()),
          ],
        );
      }
    }
    await writeSocialComments(
      client,
      context,
      postId,
      sourcePostId,
      arrayValue(comment?.replies),
      commentId,
      commentPath,
    );
  }
}

/** @param {any} client @param {any} document @param {any} context */
async function writePost(client, document, context) {
  const identifier = sourceId(document._id);
  if (!identifier) throw new ImportRecordError('invalid_post', 'Post ID is missing.');
  const author = resolveAuthor(context, document);
  const content = textValue(document.content, 2_000_000);
  if (!content) throw new ImportRecordError('invalid_post', 'Post body is empty.');
  const targetId = migrationTargetId('posts', identifier, 'post');
  const createdAt = dateValue(document.createdAt, context.clock());
  await query(
    client,
    `INSERT INTO social_posts
     (id, author_user_id, author_organization_id, content, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5)`,
    [targetId, author.userId, author.organizationId, content, createdAt],
  );
  for (const [index, attachment] of arrayValue(document.attachments).entries()) {
    const legacyUrl = textValue(attachment?.url, 2048);
    if (!legacyUrl) continue;
    const kind = ['image', 'video', 'audio', 'document'].includes(attachment?.type)
      ? attachment.type
      : 'document';
    await query(
      client,
      `INSERT INTO social_post_media (id, post_id, kind, legacy_url, position)
       VALUES ($1, $2, $3, $4, $5)`,
      [migrationChildId('posts', identifier, 'media', index), targetId, kind, legacyUrl, index],
    );
  }
  for (const [kind, values] of [
    ['like', arrayValue(document.likes)],
    ['dislike', arrayValue(document.dislikes)],
  ]) {
    for (const reference of values) {
      const userId = optionalUserTarget(context, reference);
      if (userId) {
        await query(
          client,
          `INSERT INTO social_post_reactions (post_id, user_id, kind)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [targetId, userId, kind],
        );
      }
    }
  }
  for (const reference of arrayValue(document.saves)) {
    const userId = optionalUserTarget(context, reference);
    if (userId) {
      await query(
        client,
        `INSERT INTO social_post_saves (post_id, user_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [targetId, userId],
      );
    }
  }
  for (const award of arrayValue(document.awards)) {
    const userId = optionalUserTarget(context, award?.user);
    if (userId) {
      await query(
        client,
        `INSERT INTO social_post_reactions
         (post_id, user_id, kind, award_type, created_at)
         VALUES ($1, $2, 'award', $3, $4) ON CONFLICT DO NOTHING`,
        [
          targetId,
          userId,
          textValue(award?.type, 32, 'star'),
          dateValue(award?.createdAt, context.clock()),
        ],
      );
    }
  }
  await writeSocialComments(
    client,
    context,
    targetId,
    identifier,
    arrayValue(document.comments),
    null,
    [],
  );
  return {
    targetId,
    targetType: 'post',
    warnings: arrayValue(document.attachments).length
      ? ['legacy_post_media_requires_file_mapping']
      : [],
  };
}

/** @param {any} client @param {any} document @param {any} context */
async function writeProject(client, document, context) {
  const identifier = sourceId(document._id);
  if (!identifier) throw new ImportRecordError('invalid_idea', 'Project ID is missing.');
  const author = resolveAuthor(context, document);
  const targetId = migrationTargetId('projects', identifier, 'idea');
  const updateId = migrationTargetId('projects', identifier, 'idea_update');
  const createdAt = dateValue(document.createdAt, context.clock());
  await query(
    client,
    `INSERT INTO ideas
     (id, author_user_id, author_organization_id, title, description, tech_stack,
      visibility, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::idea_visibility, $8, $9)`,
    [
      targetId,
      author.userId,
      author.organizationId,
      textValue(document.title, 255, 'Imported idea'),
      typeof document.description === 'string' ? document.description : '',
      JSON.stringify(arrayValue(document.techStack).filter((entry) => typeof entry === 'string')),
      document.visibility === 'private' ? 'private' : 'public',
      createdAt,
      dateValue(document.updatedAt, createdAt),
    ],
  );
  await query(
    client,
    `INSERT INTO idea_updates
     (id, idea_id, author_user_id, author_organization_id, title, body, created_at)
     VALUES ($1, $2, $3, $4, 'Legacy project imported',
             'Imported from the protected legacy project snapshot; review history before publishing.', $5)`,
    [updateId, targetId, author.userId, author.organizationId, createdAt],
  );
  for (const [index, milestone] of arrayValue(document.milestones).entries()) {
    const completed = Boolean(milestone?.completed);
    await query(
      client,
      `INSERT INTO idea_milestones
       (id, idea_id, title, description, completed, completed_at, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        migrationChildId('projects', identifier, 'milestone', index),
        targetId,
        textValue(milestone?.title, 255, `Milestone ${index + 1}`),
        typeof milestone?.description === 'string' ? milestone.description : null,
        completed,
        completed ? dateValue(milestone?.completedAt, context.clock()) : null,
        index,
      ],
    );
  }
  for (const reference of arrayValue(document.likes)) {
    const userId = optionalUserTarget(context, reference);
    if (userId) {
      await query(
        client,
        `INSERT INTO idea_reactions (idea_id, user_id, kind)
         VALUES ($1, $2, 'like') ON CONFLICT DO NOTHING`,
        [targetId, userId],
      );
    }
  }
  return { targetId, targetType: 'idea', warnings: [] };
}

/** @param {any} client @param {any} document @param {any} context */
async function writeYouTubeCache(client, document, context) {
  const identifier = sourceId(document._id);
  const queryText = textValue(document.query, 10_000);
  const videoId = textValue(document.videoId, 255);
  if (!identifier || !queryText || !videoId) {
    throw new ImportRecordError('invalid_integration_cache', 'Cache record is incomplete.');
  }
  const targetId = migrationTargetId('youtubecaches', identifier, 'integration_cache');
  const createdAt = dateValue(document.createdAt, context.clock());
  const expiresAt = new Date(createdAt.getTime() + 30 * 24 * 60 * 60 * 1000);
  await query(
    client,
    `INSERT INTO integration_cache
     (id, provider, key_hash, value, expires_at, created_at)
     VALUES ($1, 'youtube', $2, $3::jsonb, $4, $5)`,
    [targetId, sha256(queryText.toLowerCase()), JSON.stringify({ videoId }), expiresAt, createdAt],
  );
  return {
    targetId,
    targetType: 'integration_cache',
    warnings: ['integration_cache_query_stored_as_hash_only'],
  };
}

/** @type {Readonly<Record<string, (...argumentsList: any[]) => Promise<any>>>} */
export const RECORD_WRITERS = Object.freeze({
  authidentities: writeAuthIdentity,
  authsessions: skipSession,
  authority_audit_events: writeAuthorityAudit,
  authority_controls: writeAuthorityControl,
  challenges: writeChallenge,
  companies: writeCompany,
  companyemployees: writeCompanyEmployee,
  courses: writeCourse,
  enrollments: writeEnrollment,
  identityonetimetokens: skipOneTimeToken,
  organizationinvitations: skipInvitation,
  organizationmemberships: writeOrganizationMembership,
  organizations: writeOrganization,
  posts: writePost,
  projects: writeProject,
  providerverificationreviews: writeProviderReview,
  users: writeUser,
  youtubecaches: writeYouTubeCache,
});

export const IMPORT_ORDER = Object.freeze([
  'users',
  'authidentities',
  'authsessions',
  'identityonetimetokens',
  'organizations',
  'organizationmemberships',
  'organizationinvitations',
  'providerverificationreviews',
  'authority_controls',
  'authority_audit_events',
  'companies',
  'companyemployees',
  'challenges',
  'courses',
  'enrollments',
  'posts',
  'projects',
  'youtubecaches',
]);

/**
 * Challenge links are embedded on users but reference challenges, so they are
 * attached only after both source families have completed.
 *
 * @param {any} client
 * @param {Map<string, any[]>} documents
 * @param {any} context
 */
export async function attachUserChallengeLinks(client, documents, context) {
  let bookmarks = 0;
  let solves = 0;
  for (const document of documents.get('users') || []) {
    const identifier = sourceId(document._id);
    if (!identifier || !context.plannedSources.has(`users:${identifier}`)) continue;
    const userId = migrationTargetId('users', identifier, 'user');
    for (const entry of arrayValue(document.savedChallenges)) {
      const challengeSourceId = sourceId(entry);
      if (!challengeSourceId || !context.plannedSources.has(`challenges:${challengeSourceId}`)) {
        continue;
      }
      const challengeId = migrationTargetId('challenges', challengeSourceId, 'challenge');
      const result = await query(
        client,
        `INSERT INTO challenge_bookmarks (user_id, challenge_id)
         SELECT $1, $2 WHERE EXISTS (SELECT 1 FROM challenges WHERE id = $2)
         ON CONFLICT DO NOTHING`,
        [userId, challengeId],
      );
      bookmarks += result.rowCount || 0;
    }
    for (const entry of arrayValue(document.solvedChallenges)) {
      const challengeSourceId = sourceId(entry?.challenge);
      if (!challengeSourceId || !context.plannedSources.has(`challenges:${challengeSourceId}`)) {
        continue;
      }
      const challengeId = migrationTargetId('challenges', challengeSourceId, 'challenge');
      const result = await query(
        client,
        `INSERT INTO challenge_solves (user_id, challenge_id, solved_at)
         SELECT $1, $2, $3 WHERE EXISTS (SELECT 1 FROM challenges WHERE id = $2)
         ON CONFLICT DO NOTHING`,
        [userId, challengeId, dateValue(entry?.solvedAt, context.clock())],
      );
      solves += result.rowCount || 0;
    }
  }
  return { bookmarks, solves };
}

export function migrationConfigurationHash() {
  return sha256(
    stableStringify({
      credentialPolicy: 'supported-local-hash-or-reset',
      identityPolicy: 'google-sub-required',
      invitationPolicy: 'discard-and-reissue',
      legacyChallengeTestVisibility: 'visible',
      progressPolicy: 'non-authoritative-snapshot',
      sessionPolicy: 'invalidate-all',
      transformer: 'p0c-s4-v1',
    }),
  );
}
