import {
  canonicalize,
  fingerprint,
  sha256,
  sourceIdentifier,
  stableStringify,
} from './canonical-json.mjs';
import { COLLECTION_NAMES, MIGRATION_SCHEMA_VERSION } from './collection-registry.mjs';
import { buildDryRunPlan } from './dry-run-planner.mjs';
import {
  attachUserChallengeLinks,
  ImportRecordError,
  IMPORT_ORDER,
  migrationConfigurationHash,
  RECORD_WRITERS,
} from './postgres-record-writers.mjs';

const SOURCE_SYSTEM = 'codewithmee-mongo';

/** @param {any} client @param {string} sql @param {unknown[]} values */
async function query(client, sql, values = []) {
  return client.query(sql, values);
}

/** @param {unknown} value */
function normalizedEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : null;
}

/**
 * @param {import('./types.mjs').MigrationSource} source
 * @param {number} maximumRecords
 */
async function collectDocuments(source, maximumRecords) {
  /** @type {Map<string, import('./types.mjs').LegacyDocument[]>} */
  const documents = new Map();
  let total = 0;
  for (const collectionName of COLLECTION_NAMES) {
    /** @type {import('./types.mjs').LegacyDocument[]} */
    const records = [];
    for await (const document of source.iterateCollection(collectionName)) {
      total += 1;
      if (total > maximumRecords) {
        throw new Error(`Snapshot exceeds the configured ${maximumRecords} record import limit.`);
      }
      records.push(canonicalize(document));
    }
    documents.set(collectionName, records);
  }
  return { documents, total };
}

/** @param {any} error */
function safeFailure(error) {
  if (error instanceof ImportRecordError) {
    return { code: error.code, databaseCode: null, message: error.message };
  }
  return {
    code: 'target_write_rejected',
    databaseCode:
      typeof error?.code === 'string' && /^[A-Z0-9_]{2,20}$/i.test(error.code) ? error.code : null,
    message: 'The normalized target rejected this source record; inspect constraints privately.',
  };
}

/**
 * @param {any} client
 * @param {string} importRunId
 * @param {{code: string, message: string, severity?: string, sourceFingerprint: string | null, sourceType: string, details?: Record<string, unknown>}} input
 */
async function insertException(client, importRunId, input) {
  await query(
    client,
    `INSERT INTO import_exceptions
     (import_run_id, source_type, source_id, code, severity, message, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      importRunId,
      input.sourceType,
      input.sourceFingerprint,
      input.code.slice(0, 120),
      input.severity || 'warning',
      input.message.slice(0, 1000),
      JSON.stringify(input.details || {}),
    ],
  );
}

/**
 * @param {any} client
 * @param {{details: Record<string, unknown>, importRunId: string, sourceChecksum: string, sourceFingerprint: string, sourceType: string, state: string, targetId: string | null, targetType: string | null}} input
 */
async function insertImportRecord(client, input) {
  await query(
    client,
    `INSERT INTO import_records
     (import_run_id, source_type, source_id, source_checksum, target_type, target_id, state, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7::import_record_state, $8::jsonb)`,
    [
      input.importRunId,
      input.sourceType,
      input.sourceFingerprint,
      input.sourceChecksum,
      input.targetType,
      input.targetId,
      input.state,
      JSON.stringify(input.details),
    ],
  );
}

/** @param {any} client @param {string} runId */
async function existingRunResult(client, runId) {
  const result = await query(client, `SELECT id, state, summary FROM import_runs WHERE id = $1`, [
    runId,
  ]);
  if (result.rowCount !== 1) throw new Error('Import run disappeared during reconciliation.');
  if (result.rows[0].state !== 'reconciled') {
    throw new Error(
      `Matching import run is ${result.rows[0].state}; operator recovery is required.`,
    );
  }
  return canonicalize({
    ...(result.rows[0].summary || {}),
    idempotentReplay: true,
    importRunId: result.rows[0].id,
  });
}

/**
 * @param {any} client
 * @param {{configurationHash: string, snapshotFingerprint: string, sourceChecksum: string}} input
 */
async function createImportRun(client, input) {
  const inserted = await query(
    client,
    `INSERT INTO import_runs
     (source_system, source_snapshot, source_checksum, configuration_hash, state, dry_run)
     VALUES ($1, $2, $3, $4, 'importing', false)
     ON CONFLICT (source_system, source_checksum, configuration_hash, dry_run) DO NOTHING
     RETURNING id`,
    [SOURCE_SYSTEM, input.snapshotFingerprint, input.sourceChecksum, input.configurationHash],
  );
  if (inserted.rowCount === 1) return { importRunId: inserted.rows[0].id, replay: null };
  const existing = await query(
    client,
    `SELECT id FROM import_runs
     WHERE source_system = $1 AND source_checksum = $2
       AND configuration_hash = $3 AND dry_run = false`,
    [SOURCE_SYSTEM, input.sourceChecksum, input.configurationHash],
  );
  if (existing.rowCount !== 1) throw new Error('Import idempotency lookup failed.');
  return {
    importRunId: existing.rows[0].id,
    replay: await existingRunResult(client, existing.rows[0].id),
  };
}

/**
 * Write one authenticated snapshot into a migrated PostgreSQL target. It never
 * opens MongoDB and emits only fingerprints/counts.
 *
 * @param {{
 *   clock?: () => Date,
 *   fingerprintKey: Buffer,
 *   maximumRecords?: number,
 *   pool: any,
 *   snapshotLabel: string,
 *   source: import('./types.mjs').MigrationSource
 * }} options
 */
export async function importSnapshotToPostgres({
  clock = () => new Date(),
  fingerprintKey,
  maximumRecords = 250_000,
  pool,
  snapshotLabel,
  source,
}) {
  if (source.kind !== 'encrypted_snapshot') {
    throw new Error('PostgreSQL import accepts only an authenticated encrypted snapshot.');
  }
  const sourceChecksum = source.manifest?.datasetSha256;
  if (typeof sourceChecksum !== 'string' || !/^[0-9a-f]{64}$/.test(sourceChecksum)) {
    throw new Error('Encrypted snapshot has no valid dataset checksum.');
  }
  if (!Number.isInteger(maximumRecords) || maximumRecords < 1 || maximumRecords > 5_000_000) {
    throw new Error('maximumRecords must be an integer between 1 and 5000000.');
  }
  const configurationHash = migrationConfigurationHash();
  const snapshotFingerprint = `snapshot:${fingerprint(snapshotLabel, fingerprintKey)}`;
  const planResult = await buildDryRunPlan({ clock, fingerprintKey, source });
  const { documents, total } = await collectDocuments(source, maximumRecords);

  /** @type {Map<string, import('./types.mjs').PlanEntry[]>} */
  const planByRecord = new Map();
  for (const entry of planResult.plan) {
    const key = `${entry.sourceCollection}:${entry.sourceIdFingerprint || 'missing'}`;
    const entries = planByRecord.get(key) || [];
    entries.push(entry);
    planByRecord.set(key, entries);
  }
  /** @type {Map<string, import('./types.mjs').MigrationException[]>} */
  const exceptionsByRecord = new Map();
  for (const entry of planResult.report.exceptions) {
    const key = `${entry.collection}:${entry.sourceIdFingerprint || 'missing'}`;
    const entries = exceptionsByRecord.get(key) || [];
    entries.push(entry);
    exceptionsByRecord.set(key, entries);
  }

  const plannedSources = new Set();
  for (const [collectionName, records] of documents) {
    for (const document of records) {
      const identifier = sourceIdentifier(document._id);
      if (!identifier) continue;
      const sourceFingerprint = fingerprint(identifier, fingerprintKey);
      const entries = planByRecord.get(`${collectionName}:${sourceFingerprint}`) || [];
      if (entries.length && entries.every((entry) => entry.state === 'planned')) {
        plannedSources.add(`${collectionName}:${identifier}`);
      }
    }
  }

  const userSourceByEmail = new Map();
  const duplicateEmails = new Set();
  for (const document of documents.get('users') || []) {
    const email = normalizedEmail(document.email);
    const identifier = sourceIdentifier(document._id);
    if (!email || !identifier) continue;
    if (userSourceByEmail.has(email)) duplicateEmails.add(email);
    else userSourceByEmail.set(email, identifier);
  }
  for (const email of duplicateEmails) userSourceByEmail.delete(email);
  const authIdentitySourceUsers = new Set(
    (documents.get('authidentities') || [])
      .map((document) => sourceIdentifier(document.user))
      .filter(Boolean),
  );
  const context = Object.freeze({
    authIdentitySourceUsers,
    clock,
    /** @param {unknown} value */
    fingerprint: (value) => fingerprint(value, fingerprintKey),
    plannedSources,
    userSourceByEmail,
  });

  const control = await pool.connect();
  let importRunId;
  try {
    await query(control, 'BEGIN');
    const run = await createImportRun(control, {
      configurationHash,
      snapshotFingerprint,
      sourceChecksum,
    });
    importRunId = run.importRunId;
    await query(control, 'COMMIT');
    if (run.replay) return run.replay;
  } catch (error) {
    await query(control, 'ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    control.release();
  }

  const counts = { imported: 0, quarantined: 0, skipped: 0 };
  const warningCodes = new Set();
  try {
    const exceptionClient = await pool.connect();
    try {
      await query(exceptionClient, 'BEGIN');
      for (const exception of planResult.report.exceptions) {
        await insertException(exceptionClient, importRunId, {
          code: exception.code,
          message: exception.message,
          severity: exception.severity,
          sourceFingerprint: exception.sourceIdFingerprint,
          sourceType: exception.collection,
          details: { fields: exception.fields },
        });
      }
      await query(exceptionClient, 'COMMIT');
    } catch (error) {
      await query(exceptionClient, 'ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      exceptionClient.release();
    }

    for (const collectionName of IMPORT_ORDER) {
      const writer = RECORD_WRITERS[collectionName];
      if (!writer) throw new Error(`No PostgreSQL writer exists for ${collectionName}.`);
      for (const document of documents.get(collectionName) || []) {
        const identifier = sourceIdentifier(document._id);
        const sourceFingerprint = identifier
          ? fingerprint(identifier, fingerprintKey)
          : fingerprint(sha256(stableStringify(document)), fingerprintKey);
        const planKey = `${collectionName}:${identifier ? sourceFingerprint : 'missing'}`;
        const entries = planByRecord.get(planKey) || [];
        const exceptions = exceptionsByRecord.get(planKey) || [];
        const sourceChecksumForRecord = sha256(stableStringify(document));
        const planned =
          Boolean(identifier) &&
          entries.length > 0 &&
          entries.every((entry) => entry.state === 'planned');
        if (!planned) {
          const client = await pool.connect();
          try {
            await query(client, 'BEGIN');
            await insertImportRecord(client, {
              details: {
                exceptionCodes: [...new Set(exceptions.map((entry) => entry.code))].sort(),
                targetTypes: [...new Set(entries.map((entry) => entry.targetType))].sort(),
                transformer: 'p0c-s4-v1',
              },
              importRunId,
              sourceChecksum: sourceChecksumForRecord,
              sourceFingerprint,
              sourceType: collectionName,
              state: 'quarantined',
              targetId: null,
              targetType: null,
            });
            await query(client, 'COMMIT');
            counts.quarantined += 1;
          } catch (error) {
            await query(client, 'ROLLBACK').catch(() => undefined);
            throw error;
          } finally {
            client.release();
          }
          continue;
        }

        const client = await pool.connect();
        try {
          await query(client, 'BEGIN');
          const outcome = await writer(client, document, context);
          const state = outcome.state || 'imported';
          const warnings = [...new Set(outcome.warnings || [])].sort();
          for (const code of warnings) {
            warningCodes.add(code);
            if (!exceptions.some((entry) => entry.code === code)) {
              await insertException(client, importRunId, {
                code,
                message: 'A security-preserving import policy changed or deferred legacy state.',
                severity: 'warning',
                sourceFingerprint,
                sourceType: collectionName,
              });
            }
          }
          await insertImportRecord(client, {
            details: {
              targetTypes: [...new Set(entries.map((entry) => entry.targetType))].sort(),
              transformer: 'p0c-s4-v1',
              warnings,
            },
            importRunId,
            sourceChecksum: sourceChecksumForRecord,
            sourceFingerprint,
            sourceType: collectionName,
            state,
            targetId: outcome.targetId,
            targetType: outcome.targetType,
          });
          await query(client, 'COMMIT');
          if (state === 'skipped') counts.skipped += 1;
          else counts.imported += 1;
        } catch (error) {
          await query(client, 'ROLLBACK').catch(() => undefined);
          const failure = safeFailure(error);
          const quarantineClient = await pool.connect();
          try {
            await query(quarantineClient, 'BEGIN');
            await insertImportRecord(quarantineClient, {
              details: {
                databaseCode: failure.databaseCode,
                targetTypes: [...new Set(entries.map((entry) => entry.targetType))].sort(),
                transformer: 'p0c-s4-v1',
              },
              importRunId,
              sourceChecksum: sourceChecksumForRecord,
              sourceFingerprint,
              sourceType: collectionName,
              state: 'quarantined',
              targetId: null,
              targetType: null,
            });
            await insertException(quarantineClient, importRunId, {
              code: failure.code,
              details: { databaseCode: failure.databaseCode },
              message: failure.message,
              severity: 'error',
              sourceFingerprint,
              sourceType: collectionName,
            });
            await query(quarantineClient, 'COMMIT');
            counts.quarantined += 1;
          } catch (quarantineError) {
            await query(quarantineClient, 'ROLLBACK').catch(() => undefined);
            throw quarantineError;
          } finally {
            quarantineClient.release();
          }
        } finally {
          client.release();
        }
      }
    }

    const linkClient = await pool.connect();
    let challengeLinks;
    try {
      await query(linkClient, 'BEGIN');
      challengeLinks = await attachUserChallengeLinks(linkClient, documents, context);
      await query(linkClient, 'COMMIT');
    } catch (error) {
      await query(linkClient, 'ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      linkClient.release();
    }

    const summary = canonicalize({
      challengeLinks,
      configurationHash,
      counts,
      idempotentReplay: false,
      importRunId,
      planSha256: planResult.report.planSha256,
      schemaVersion: MIGRATION_SCHEMA_VERSION,
      sourceCollectionCounts: Object.fromEntries(
        [...documents.entries()]
          .map(([collection, records]) => [collection, records.length])
          .sort(([left], [right]) => String(left).localeCompare(String(right))),
      ),
      sourceChecksum,
      sourceRecords: total,
      warningCodes: [...warningCodes].sort(),
      writesPerformed: true,
    });
    const finalClient = await pool.connect();
    try {
      await query(
        finalClient,
        `UPDATE import_runs
         SET state = 'reconciled', completed_at = $2, summary = $3::jsonb
         WHERE id = $1 AND state = 'importing'`,
        [importRunId, clock(), JSON.stringify(summary)],
      );
    } finally {
      finalClient.release();
    }
    return summary;
  } catch (error) {
    const failureClient = await pool.connect().catch(() => null);
    if (failureClient) {
      try {
        await query(
          failureClient,
          `UPDATE import_runs
           SET state = 'failed', completed_at = now(),
               summary = $2::jsonb
           WHERE id = $1 AND state = 'importing'`,
          [
            importRunId,
            JSON.stringify({
              counts,
              failureCode: 'import_infrastructure_failure',
              sourceChecksum,
              writesPerformed: true,
            }),
          ],
        );
      } finally {
        failureClient.release();
      }
    }
    throw error;
  }
}
