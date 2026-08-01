'use strict';

const { FileError } = require('./errors');
const { FILE_SCAN_STATUS, FILE_STATE } = require('./contracts');

function toRecord(row) {
  if (!row) return null;
  return Object.freeze({
    byteSize: Number(row.byte_size),
    createdAt: row.created_at,
    declaredMime: row.declared_mime,
    deletedAt: row.deleted_at,
    detectedMime: row.detected_mime,
    etag: row.etag,
    id: row.id,
    originalName: row.original_name,
    ownerOrganizationId: row.owner_organization_id,
    ownerUserId: row.owner_user_id,
    purpose: row.purpose,
    quarantineReason: row.quarantine_reason,
    scannedAt: row.scanned_at,
    scanStatus: row.scan_status,
    sha256: row.sha256,
    state: row.state,
    storageBucket: row.storage_bucket,
    storageKey: row.storage_key,
    storageProvider: row.storage_provider,
    updatedAt: row.updated_at,
    uploadedAt: row.uploaded_at,
    uploadedByUserId: row.uploaded_by_user_id,
    visibility: row.visibility,
  });
}

async function withTransaction(pool, operation) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function rowById(client, id) {
  const result = await client.query('SELECT * FROM files WHERE id = $1', [id]);
  if (!result.rows[0]) throw new FileError('file_not_found', 404);
  return result.rows[0];
}

async function appendOutbox(client, row, eventType, availableAt) {
  await client.query(
    `INSERT INTO outbox_events
      (aggregate_type, aggregate_id, event_type, payload, available_at)
     VALUES ('file', $1, $2, $3::jsonb, $4)`,
    [row.id, eventType, JSON.stringify({ fileId: row.id, purpose: row.purpose }), availableAt],
  );
}

function createPostgresFileRepository(pool) {
  if (!pool || typeof pool.query !== 'function' || typeof pool.connect !== 'function') {
    throw new Error('A PostgreSQL pool is required');
  }
  return Object.freeze({
    async create(record) {
      const result = await pool.query(
        `INSERT INTO files
          (id, owner_user_id, owner_organization_id, uploaded_by_user_id, purpose,
           storage_provider, storage_bucket, storage_key, original_name, declared_mime,
           byte_size, sha256, state, scan_status, visibility, created_at, updated_at)
         VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
           'upload_pending', 'pending', 'private', $13, $13)
         RETURNING *`,
        [
          record.id,
          record.ownerUserId,
          record.ownerOrganizationId,
          record.uploadedByUserId,
          record.purpose,
          record.storageProvider,
          record.storageBucket,
          record.storageKey,
          record.originalName,
          record.declaredMime,
          record.byteSize,
          record.sha256,
          record.createdAt,
        ],
      );
      return toRecord(result.rows[0]);
    },
    async getById(id) {
      const result = await pool.query('SELECT * FROM files WHERE id = $1', [id]);
      return toRecord(result.rows[0]);
    },
    async listCleanupCandidates({ pendingBefore, quarantineBefore }) {
      const result = await pool.query(
        `SELECT * FROM files
         WHERE (state = 'upload_pending' AND created_at < $1)
            OR (state = 'quarantined' AND scanned_at < $2)
         ORDER BY created_at ASC, id ASC
         LIMIT 500`,
        [pendingBefore, quarantineBefore],
      );
      return result.rows.map(toRecord);
    },
    async listForReconciliation({ limit = 100_000 } = {}) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 1_000_000) {
        throw new Error('File reconciliation limit must be between 1 and 1000000.');
      }
      const result = await pool.query(
        `SELECT * FROM files ORDER BY storage_key ASC, id ASC LIMIT $1`,
        [limit + 1],
      );
      if (result.rows.length > limit) throw new Error('File reconciliation limit exceeded.');
      return result.rows.map(toRecord);
    },
    async markDeleted({ deletedAt, id }) {
      return withTransaction(pool, async (client) => {
        const result = await client.query(
          `UPDATE files
           SET deleted_at = $2, state = 'deleted', updated_at = $2, visibility = 'private'
           WHERE id = $1 AND state <> 'deleted'
           RETURNING *`,
          [id, deletedAt],
        );
        const row = result.rows[0] || (await rowById(client, id));
        if (result.rows[0])
          await appendOutbox(client, row, 'file.object.delete_requested', deletedAt);
        return toRecord(row);
      });
    },
    async markRejectedUpload({ detectedMime, etag, id, quarantineReason, rejectedAt }) {
      return withTransaction(pool, async (client) => {
        const result = await client.query(
          `UPDATE files
           SET detected_mime = $2, etag = $3, quarantine_reason = $4,
               scanned_at = $5, scan_status = 'failed', state = 'quarantined',
               updated_at = $5, uploaded_at = $5
           WHERE id = $1 AND state = 'upload_pending'
           RETURNING *`,
          [id, detectedMime, etag, quarantineReason, rejectedAt],
        );
        if (!result.rows[0]) {
          await rowById(client, id);
          throw new FileError('file_state_conflict', 409);
        }
        await appendOutbox(client, result.rows[0], 'file.quarantined', rejectedAt);
        return toRecord(result.rows[0]);
      });
    },
    async markScanResult({ detectedMime, id, quarantineReason, scannedAt, scanStatus, sha256 }) {
      return withTransaction(pool, async (client) => {
        const ready = scanStatus === FILE_SCAN_STATUS.CLEAN;
        const result = await client.query(
          `UPDATE files
           SET detected_mime = $2, quarantine_reason = $3, scanned_at = $4,
               scan_status = $5::file_scan_status,
               sha256 = $6, state = $7::file_state, updated_at = $4
           WHERE id = $1 AND state = 'upload_pending' AND uploaded_at IS NOT NULL
           RETURNING *`,
          [
            id,
            detectedMime,
            quarantineReason,
            scannedAt,
            scanStatus,
            sha256,
            ready ? FILE_STATE.READY : FILE_STATE.QUARANTINED,
          ],
        );
        if (!result.rows[0]) {
          const current = await rowById(client, id);
          if (
            current.state === FILE_STATE.READY &&
            current.scan_status === FILE_SCAN_STATUS.CLEAN
          ) {
            return toRecord(current);
          }
          throw new FileError('file_state_conflict', 409);
        }
        await appendOutbox(
          client,
          result.rows[0],
          ready ? 'file.ready' : 'file.quarantined',
          scannedAt,
        );
        return toRecord(result.rows[0]);
      });
    },
    async markUploaded({ etag, id, uploadedAt }) {
      return withTransaction(pool, async (client) => {
        const result = await client.query(
          `UPDATE files
           SET etag = $2, uploaded_at = $3, updated_at = $3
           WHERE id = $1 AND state = 'upload_pending' AND uploaded_at IS NULL
           RETURNING *`,
          [id, etag, uploadedAt],
        );
        if (!result.rows[0]) {
          const current = await rowById(client, id);
          if (current.state === FILE_STATE.UPLOAD_PENDING && current.uploaded_at) {
            return toRecord(current);
          }
          throw new FileError('file_state_conflict', 409);
        }
        await appendOutbox(client, result.rows[0], 'file.scan.requested', uploadedAt);
        return toRecord(result.rows[0]);
      });
    },
    async setVisibility({ id, updatedAt, visibility }) {
      return withTransaction(pool, async (client) => {
        const result = await client.query(
          `UPDATE files
           SET visibility = $2::file_visibility, updated_at = $3
           WHERE id = $1 AND state = 'ready' AND scan_status = 'clean'
           RETURNING *`,
          [id, visibility, updatedAt],
        );
        if (!result.rows[0]) {
          await rowById(client, id);
          throw new FileError('file_not_ready', 409);
        }
        await appendOutbox(client, result.rows[0], 'file.visibility.changed', updatedAt);
        return toRecord(result.rows[0]);
      });
    },
  });
}

module.exports = { createPostgresFileRepository, toRecord };
