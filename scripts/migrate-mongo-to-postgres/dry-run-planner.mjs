import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  COLLECTION_BY_NAME,
  COLLECTION_NAMES,
  MIGRATION_SCHEMA_VERSION,
} from './collection-registry.mjs';
import {
  canonicalize,
  fingerprint,
  sha256,
  sourceIdentifier,
  stableStringify,
} from './canonical-json.mjs';
import { migrationTargetId } from './target-identifiers.mjs';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** @type {Readonly<Record<string, readonly (readonly [string, string, boolean])[]>>} */
const REFERENCE_RULES = Object.freeze({
  authidentities: [['user', 'users', true]],
  authsessions: [['user', 'users', true]],
  authority_audit_events: [],
  authority_controls: [],
  challenges: [['author', 'users', true]],
  companies: [],
  companyemployees: [
    ['company', 'companies', true],
    ['user', 'users', true],
  ],
  courses: [['company', 'companies', true]],
  enrollments: [
    ['user', 'users', true],
    ['course', 'courses', true],
    ['company', 'companies', true],
  ],
  identityonetimetokens: [['user', 'users', true]],
  organizationinvitations: [
    ['organization', 'organizations', true],
    ['invitedBy', 'users', true],
    ['acceptedBy', 'users', false],
  ],
  organizationmemberships: [
    ['organization', 'organizations', true],
    ['user', 'users', true],
    ['invitedBy', 'users', false],
  ],
  organizations: [['owner', 'users', true]],
  posts: [],
  projects: [],
  providerverificationreviews: [
    ['organization', 'organizations', true],
    ['submittedBy', 'users', true],
    ['reviewer', 'users', false],
  ],
  users: [],
  youtubecaches: [],
});

/** @param {unknown} value */
function normalizedEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : null;
}

/** @param {any} comments */
function flattenCommentCount(comments) {
  if (!Array.isArray(comments)) return 0;
  return comments.reduce((total, comment) => total + 1 + flattenCommentCount(comment?.replies), 0);
}

/**
 * @param {string} collectionName
 * @param {import('./types.mjs').LegacyDocument} document
 */
function planTargets(collectionName, document) {
  const definition = COLLECTION_BY_NAME.get(collectionName);
  if (!definition) throw new Error(`Missing migration registry entry for ${collectionName}`);
  const targets = [...definition.targets];
  if (collectionName === 'challenges') {
    const cases = Array.isArray(document.testCases) ? document.testCases : [];
    return [
      'challenge',
      'challenge_version',
      ...cases.map((_, index) => `challenge_test_case:${index}`),
    ];
  }
  return targets;
}

/** @param {string} target */
function targetType(target) {
  return target.split(':')[0];
}

/**
 * @param {string} collectionName
 * @param {import('./types.mjs').LegacyDocument} document
 * @returns {import('./types.mjs').LegacyDocument}
 */
function safeMetadata(collectionName, document) {
  if (collectionName === 'users') {
    return {
      conversations: Array.isArray(document.conversations) ? document.conversations.length : 0,
      hasLegacyResetToken: Boolean(document.resetPasswordToken),
      notes: Array.isArray(document.notes) ? document.notes.length : 0,
      roadmaps: Array.isArray(document.roadmaps) ? document.roadmaps.length : 0,
      sandboxConversations: Array.isArray(document.sandboxConversations)
        ? document.sandboxConversations.length
        : 0,
      socialEdges:
        (document.following?.length || 0) +
        (document.followers?.length || 0) +
        (document.pendingFollowRequests?.length || 0) +
        (document.sentFollowRequests?.length || 0) +
        (document.blockedUsers?.length || 0),
      videoProgress: Array.isArray(document.videoProgress) ? document.videoProgress.length : 0,
    };
  }
  if (collectionName === 'challenges') {
    return {
      legacyTestCount: Array.isArray(document.testCases) ? document.testCases.length : 0,
      legacyTestVisibility: 'visible',
      nestedCommentCount: flattenCommentCount(document.comments),
    };
  }
  if (collectionName === 'courses') {
    return {
      moduleCount: Array.isArray(document.modules) ? document.modules.length : 0,
      paidWithoutCurrency: document.pricing === 'paid' && Number(document.price || 0) > 0,
    };
  }
  if (collectionName === 'enrollments') {
    return {
      completedContentCount: Array.isArray(document.completedContents)
        ? document.completedContents.length
        : 0,
      progressImportedAsSnapshot: true,
    };
  }
  if (collectionName === 'posts') {
    return {
      attachmentCount: Array.isArray(document.attachments) ? document.attachments.length : 0,
      nestedCommentCount: flattenCommentCount(document.comments),
    };
  }
  if (collectionName === 'projects') {
    return {
      milestoneCount: Array.isArray(document.milestones) ? document.milestones.length : 0,
      visibility: document.visibility === 'private' ? 'private' : 'public',
    };
  }
  return {};
}

/** @param {unknown} value */
function passwordHashSupported(value) {
  return value === null || value === undefined || /^\$(?:2[aby]|argon2id)\$/.test(String(value));
}

/**
 * @param {{
 *   clock?: () => Date,
 *   fingerprintKey: Buffer,
 *   source: import('./types.mjs').MigrationSource
 * }} options
 */
export async function buildDryRunPlan({ clock = () => new Date(), fingerprintKey, source }) {
  /** @type {Map<string, import('./types.mjs').LegacyDocument[]>} */
  const documents = new Map();
  /** @type {Map<string, Set<string>>} */
  const identifiers = new Map();
  for (const collectionName of COLLECTION_NAMES) {
    /** @type {import('./types.mjs').LegacyDocument[]} */
    const records = [];
    /** @type {Set<string>} */
    const ids = new Set();
    for await (const document of source.iterateCollection(collectionName)) {
      const canonical = canonicalize(document);
      records.push(canonical);
      const identifier = sourceIdentifier(canonical._id);
      if (identifier) ids.add(identifier);
    }
    documents.set(collectionName, records);
    identifiers.set(collectionName, ids);
  }

  /** @type {Map<string, Array<string | null>>} */
  const userEmailSources = new Map();
  for (const user of documents.get('users') || []) {
    const email = normalizedEmail(user.email);
    if (!email) continue;
    const entries = userEmailSources.get(email) || [];
    entries.push(sourceIdentifier(user._id));
    userEmailSources.set(email, entries);
  }

  /** @type {import('./types.mjs').PlanEntry[]} */
  const plan = [];
  /** @type {import('./types.mjs').MigrationException[]} */
  const exceptions = [];
  /**
   * @param {{
   *   code: string,
   *   collection: string,
   *   fields?: string[],
   *   message: string,
   *   severity: 'warning' | 'error' | 'fatal',
   *   sourceId: string | null
   * }} exception
   */
  const addException = ({ code, collection, fields = [], message, severity, sourceId }) => {
    exceptions.push({
      code,
      collection,
      fields: [...fields].sort(),
      message,
      severity,
      sourceIdFingerprint: sourceId ? fingerprint(sourceId, fingerprintKey) : null,
    });
  };

  for (const collectionName of COLLECTION_NAMES) {
    for (const document of documents.get(collectionName) || []) {
      const sourceId = sourceIdentifier(document._id);
      let quarantined = false;
      if (!sourceId) {
        quarantined = true;
        addException({
          code: 'missing_source_identifier',
          collection: collectionName,
          message: 'Record has no stable source identifier.',
          severity: 'fatal',
          sourceId: null,
        });
      }

      for (const [field, targetCollection, required] of REFERENCE_RULES[collectionName] || []) {
        const reference = sourceIdentifier(document[field]);
        if (!reference && !required) continue;
        if (!reference || !identifiers.get(targetCollection)?.has(reference)) {
          quarantined = true;
          addException({
            code: 'dangling_reference',
            collection: collectionName,
            fields: [field],
            message: 'A required parent reference is absent from the source snapshot.',
            severity: 'error',
            sourceId,
          });
        }
      }

      if (collectionName === 'users') {
        const email = normalizedEmail(document.email);
        if (!email || !EMAIL_PATTERN.test(email)) {
          quarantined = true;
          addException({
            code: 'invalid_user_email',
            collection: collectionName,
            fields: ['email'],
            message: 'User email is missing or invalid.',
            severity: 'error',
            sourceId,
          });
        } else if ((userEmailSources.get(email) || []).length !== 1) {
          quarantined = true;
          addException({
            code: 'duplicate_normalized_email',
            collection: collectionName,
            fields: ['email'],
            message: 'Normalized user email does not map to exactly one source record.',
            severity: 'error',
            sourceId,
          });
        }
        if (!passwordHashSupported(document.password)) {
          quarantined = true;
          addException({
            code: 'unsupported_password_hash',
            collection: collectionName,
            fields: ['password'],
            message: 'Credential is not a recognized bcrypt or Argon2id hash and requires reset.',
            severity: 'fatal',
            sourceId,
          });
        }
        if (document.resetPasswordToken || document.resetPasswordExpire) {
          addException({
            code: 'legacy_reset_token_discarded',
            collection: collectionName,
            fields: ['resetPasswordExpire', 'resetPasswordToken'],
            message: 'Legacy reset material is never copied; issue a new token after cutover.',
            severity: 'warning',
            sourceId,
          });
        }
      }

      if (collectionName === 'authidentities' && !passwordHashSupported(document.passwordHash)) {
        quarantined = true;
        addException({
          code: 'unsupported_password_hash',
          collection: collectionName,
          fields: ['passwordHash'],
          message: 'Identity credential requires an operator-reviewed reset.',
          severity: 'fatal',
          sourceId,
        });
      }

      if (collectionName === 'companies') {
        const email = normalizedEmail(document.adminEmail);
        const matches = email ? userEmailSources.get(email) || [] : [];
        if (matches.length !== 1) {
          quarantined = true;
          addException({
            code:
              matches.length > 1 ? 'ambiguous_company_admin_email' : 'company_admin_claim_required',
            collection: collectionName,
            fields: ['adminEmail'],
            message:
              'Legacy company credential cannot become a human owner without one user claim.',
            severity: 'error',
            sourceId,
          });
        }
      }

      if (collectionName === 'challenges' && (document.testCases?.length || 0) > 0) {
        addException({
          code: 'legacy_tests_forced_visible',
          collection: collectionName,
          fields: ['testCases'],
          message:
            'Every legacy case is planned as visible until an author performs explicit review.',
          severity: 'warning',
          sourceId,
        });
      }

      if (
        collectionName === 'challenges' &&
        (!['Easy', 'Medium', 'Hard'].includes(document.difficulty) ||
          !Number.isInteger(Number(document.score)) ||
          Number(document.score) < 1 ||
          Number(document.score) > 10)
      ) {
        quarantined = true;
        addException({
          code: 'invalid_challenge_contract',
          collection: collectionName,
          fields: ['difficulty', 'score'],
          message: 'Legacy challenge difficulty or score is invalid.',
          severity: 'error',
          sourceId,
        });
      }

      if (
        collectionName === 'courses' &&
        document.pricing === 'paid' &&
        Number(document.price || 0) > 0
      ) {
        quarantined = true;
        addException({
          code: 'paid_course_currency_missing',
          collection: collectionName,
          fields: ['price', 'pricing'],
          message: 'Legacy paid course has no trustworthy ISO currency and requires review.',
          severity: 'error',
          sourceId,
        });
      }

      if (collectionName === 'enrollments') {
        addException({
          code: 'progress_imported_as_snapshot',
          collection: collectionName,
          fields: ['completedContents', 'progressPercent'],
          message: 'Legacy progress is planned as a non-authoritative import snapshot.',
          severity: 'warning',
          sourceId,
        });
      }

      if (['posts', 'projects'].includes(collectionName)) {
        const authorCollection = document.authorType === 'Company' ? 'companies' : 'users';
        const author = sourceIdentifier(document.author);
        if (!author || !identifiers.get(authorCollection)?.has(author)) {
          quarantined = true;
          addException({
            code: 'dangling_polymorphic_author',
            collection: collectionName,
            fields: ['author', 'authorType'],
            message: 'Polymorphic content author cannot be resolved.',
            severity: 'error',
            sourceId,
          });
        }
      }

      const targets = planTargets(collectionName, document);
      for (const target of targets) {
        const type = targetType(target);
        plan.push({
          metadata: safeMetadata(collectionName, document),
          sourceCollection: collectionName,
          sourceIdFingerprint: sourceId ? fingerprint(sourceId, fingerprintKey) : null,
          state: quarantined ? 'quarantined' : 'planned',
          targetId: sourceId ? migrationTargetId(collectionName, sourceId, target) : null,
          targetType: type,
        });
      }
    }
  }

  plan.sort((left, right) =>
    `${left.sourceCollection}:${left.sourceIdFingerprint}:${left.targetType}:${left.targetId}`.localeCompare(
      `${right.sourceCollection}:${right.sourceIdFingerprint}:${right.targetType}:${right.targetId}`,
    ),
  );
  exceptions.sort((left, right) =>
    `${left.collection}:${left.sourceIdFingerprint}:${left.code}`.localeCompare(
      `${right.collection}:${right.sourceIdFingerprint}:${right.code}`,
    ),
  );
  const planLines = plan.map((entry) => stableStringify(entry));
  const countsByState = Object.fromEntries(
    ['planned', 'quarantined'].map((state) => [
      state,
      plan.filter((entry) => entry.state === state).length,
    ]),
  );
  const countsByTarget = Object.fromEntries(
    [...new Set(plan.map((entry) => entry.targetType))]
      .sort()
      .map((type) => [type, plan.filter((entry) => entry.targetType === type).length]),
  );

  return {
    plan,
    report: canonicalize({
      countsByState,
      countsByTarget,
      createdAt: clock().toISOString(),
      exceptionCounts: Object.fromEntries(
        ['warning', 'error', 'fatal'].map((severity) => [
          severity,
          exceptions.filter((entry) => entry.severity === severity).length,
        ]),
      ),
      exceptions,
      kind: 'codewithmee-postgres-import-dry-run',
      planSha256: sha256(planLines.map((line) => `${line}\n`).join('')),
      schemaVersion: MIGRATION_SCHEMA_VERSION,
      sourceDatasetSha256: source.manifest?.datasetSha256 || null,
      writesPerformed: false,
    }),
  };
}

/**
 * @param {{
 *   outputDirectory: string,
 *   plan: import('./types.mjs').PlanEntry[],
 *   report: import('./types.mjs').DryRunReport
 * }} options
 */
export async function writeDryRunPlan({ outputDirectory, plan, report }) {
  const absolute = path.resolve(outputDirectory);
  await mkdir(path.dirname(absolute), { recursive: true });
  await mkdir(absolute, { mode: 0o700, recursive: false });
  await writeFile(
    path.join(absolute, 'plan.ndjson'),
    plan.map((entry) => stableStringify(entry)).join('\n') + (plan.length ? '\n' : ''),
    { encoding: 'utf8', flag: 'wx', mode: 0o600 },
  );
  await writeFile(path.join(absolute, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  return absolute;
}
