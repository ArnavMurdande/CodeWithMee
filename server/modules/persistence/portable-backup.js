'use strict';

const { createCipheriv, createDecipheriv, createHash, randomBytes } = require('node:crypto');
const { gunzipSync, gzipSync } = require('node:zlib');

const ARCHIVE_FORMAT = 'codewithmee.portable-backup.v1';
const PAYLOAD_FORMAT = 'codewithmee.portable-data.v1';
const DEFAULT_MAX_PLAINTEXT_BYTES = 256 * 1024 * 1024;
const IDENTIFIER_PATTERN = /^[a-z_][a-z0-9_]*$/;
const MIGRATION_BOOTSTRAP_ROWS = Object.freeze({
  authority_controls: Object.freeze(['platform_authority', 'superadmin_bootstrap_v1']),
});
// These nullable references are presentation/current-state pointers or self-links whose temporary
// null value satisfies every database check while their referenced row is restored. Owner columns
// are intentionally absent because nulling them would violate exactly-one-owner constraints.
const SAFE_DEFERRED_FOREIGN_KEYS = new Set([
  'challenge_comments.parent_id',
  'organizations.logo_file_id',
  'session_refresh_tokens.replaced_by_token_id',
  'social_comments.parent_id',
  'users.avatar_file_id',
]);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function quoteIdentifier(value) {
  if (!IDENTIFIER_PATTERN.test(value)) throw new Error(`Unsafe PostgreSQL identifier: ${value}`);
  return `"${value}"`;
}

function parseBackupKey(rawValue) {
  if (!rawValue?.trim()) throw new Error('DATABASE_BACKUP_KEY is required.');
  const encoded = rawValue.trim();
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encoded) {
    throw new Error('DATABASE_BACKUP_KEY must be canonical base64 for exactly 32 bytes.');
  }
  return key;
}

async function listTableNames(client) {
  const result = await client.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       AND table_name <> '_prisma_migrations'
     ORDER BY table_name`,
  );
  return result.rows.map((row) => row.table_name);
}

async function tableContract(client, tableName) {
  quoteIdentifier(tableName);
  const columnResult = await client.query(
    `SELECT column_name, data_type, udt_name, is_nullable, is_generated
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1
       ORDER BY ordinal_position`,
    [tableName],
  );
  const primaryResult = await client.query(
    `SELECT kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_schema = tc.constraint_schema
        AND kcu.constraint_name = tc.constraint_name
       WHERE tc.constraint_schema = 'public' AND tc.table_name = $1
         AND tc.constraint_type = 'PRIMARY KEY'
       ORDER BY kcu.ordinal_position`,
    [tableName],
  );
  const foreignResult = await client.query(
    `SELECT kcu.column_name, ccu.table_name AS parent_table,
              ccu.column_name AS parent_column, columns.is_nullable
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_schema = tc.constraint_schema
        AND kcu.constraint_name = tc.constraint_name
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_schema = tc.constraint_schema
        AND ccu.constraint_name = tc.constraint_name
       JOIN information_schema.columns columns
         ON columns.table_schema = tc.table_schema
        AND columns.table_name = tc.table_name
        AND columns.column_name = kcu.column_name
       WHERE tc.constraint_schema = 'public' AND tc.table_name = $1
         AND tc.constraint_type = 'FOREIGN KEY'
       ORDER BY tc.constraint_name, kcu.ordinal_position`,
    [tableName],
  );
  const columns = columnResult.rows.map((column) => {
    quoteIdentifier(column.column_name);
    if (column.is_generated !== 'NEVER') {
      throw new Error(`Generated column backup is unsupported: ${tableName}.${column.column_name}`);
    }
    return Object.freeze({
      dataType: column.data_type,
      name: column.column_name,
      nullable: column.is_nullable === 'YES',
      udtName: column.udt_name,
    });
  });
  const primaryKey = primaryResult.rows.map((row) => row.column_name);
  if (!primaryKey.length) throw new Error(`Portable backup requires a primary key: ${tableName}`);
  return Object.freeze({
    columns: Object.freeze(columns),
    foreignKeys: Object.freeze(
      foreignResult.rows.map((foreignKey) =>
        Object.freeze({
          column: foreignKey.column_name,
          nullable: foreignKey.is_nullable === 'YES',
          parentColumn: foreignKey.parent_column,
          parentTable: foreignKey.parent_table,
        }),
      ),
    ),
    name: tableName,
    primaryKey: Object.freeze(primaryKey),
  });
}

async function readTableRows(client, contract) {
  const selections = contract.columns
    .map((column) => `${quoteIdentifier(column.name)}::text AS ${quoteIdentifier(column.name)}`)
    .join(', ');
  const ordering = contract.primaryKey
    .map((column) => `${quoteIdentifier(column)}::text`)
    .join(', ');
  const result = await client.query(
    `SELECT ${selections} FROM ${quoteIdentifier(contract.name)} ORDER BY ${ordering}`,
  );
  return result.rows.map((row) => contract.columns.map((column) => row[column.name] ?? null));
}

async function readPortableSnapshot(client, manifest) {
  const tables = [];
  let rowCount = 0;
  for (const tableName of await listTableNames(client)) {
    const contract = await tableContract(client, tableName);
    const rows = await readTableRows(client, contract);
    rowCount += rows.length;
    tables.push(Object.freeze({ ...contract, rows: Object.freeze(rows) }));
  }
  return Object.freeze({
    format: PAYLOAD_FORMAT,
    migrations: Object.freeze(manifest.migrations.map((migration) => migration.name)),
    rowCount,
    schemaSha256: manifest.schema.sha256,
    tableCount: tables.length,
    tables: Object.freeze(tables),
  });
}

async function exportPortableSnapshot(pool, manifest) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query(`SET LOCAL TIME ZONE 'UTC'`);
    const snapshot = await readPortableSnapshot(client, manifest);
    await client.query('COMMIT');
    return snapshot;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function createPortableArchive(
  payload,
  {
    clock = () => new Date(),
    key,
    maxPlaintextBytes = DEFAULT_MAX_PLAINTEXT_BYTES,
    sourceDatabase,
  },
) {
  if (!key || key.length !== 32) throw new Error('A 32-byte backup key is required.');
  if (!IDENTIFIER_PATTERN.test(sourceDatabase)) throw new Error('Source database name is invalid.');
  const plaintext = Buffer.from(JSON.stringify(payload));
  if (plaintext.length > maxPlaintextBytes) {
    throw new Error(`Portable backup exceeds the ${maxPlaintextBytes}-byte plaintext limit.`);
  }
  const contentSha256 = sha256(plaintext);
  const iv = randomBytes(12);
  const header = Object.freeze({
    cipher: 'aes-256-gcm',
    compression: 'gzip',
    contentSha256,
    createdAt: clock().toISOString(),
    keyFingerprint: sha256(key).slice(0, 16),
    migrations: payload.migrations,
    rowCount: payload.rowCount,
    schemaSha256: payload.schemaSha256,
    sourceDatabase,
    tableCount: payload.tableCount,
  });
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(JSON.stringify(header)));
  const ciphertext = Buffer.concat([
    cipher.update(gzipSync(plaintext, { level: 9 })),
    cipher.final(),
  ]);
  const archive = Buffer.from(
    `${JSON.stringify({
      ciphertext: ciphertext.toString('base64'),
      format: ARCHIVE_FORMAT,
      header,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
    })}\n`,
  );
  return Object.freeze({
    archive,
    archiveSha256: sha256(archive),
    contentSha256,
    rowCount: payload.rowCount,
    tableCount: payload.tableCount,
  });
}

function openPortableArchive(archive, { key, maxPlaintextBytes = DEFAULT_MAX_PLAINTEXT_BYTES }) {
  if (!key || key.length !== 32) throw new Error('A 32-byte backup key is required.');
  let envelope;
  try {
    envelope = JSON.parse(Buffer.from(archive).toString('utf8'));
  } catch {
    throw new Error('Portable backup envelope is not valid JSON.');
  }
  if (envelope.format !== ARCHIVE_FORMAT || envelope.header?.cipher !== 'aes-256-gcm') {
    throw new Error('Portable backup format is unsupported.');
  }
  if (envelope.header.keyFingerprint !== sha256(key).slice(0, 16)) {
    throw new Error('Portable backup key does not match the archive.');
  }
  try {
    const decode = (name, value, expectedBytes = null) => {
      if (typeof value !== 'string') throw new Error(`Portable backup ${name} is invalid.`);
      const decoded = Buffer.from(value, 'base64');
      if (
        decoded.toString('base64') !== value ||
        (expectedBytes && decoded.length !== expectedBytes)
      ) {
        throw new Error(`Portable backup ${name} is invalid.`);
      }
      return decoded;
    };
    const iv = decode('initialization vector', envelope.iv, 12);
    const tag = decode('authentication tag', envelope.tag, 16);
    const ciphertext = decode('ciphertext', envelope.ciphertext);
    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
    decipher.setAAD(Buffer.from(JSON.stringify(envelope.header)));
    decipher.setAuthTag(tag);
    const compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const plaintext = gunzipSync(compressed, { maxOutputLength: maxPlaintextBytes });
    if (sha256(plaintext) !== envelope.header.contentSha256) {
      throw new Error('Portable backup content checksum mismatch.');
    }
    const payload = JSON.parse(plaintext.toString('utf8'));
    if (
      payload.format !== PAYLOAD_FORMAT ||
      payload.schemaSha256 !== envelope.header.schemaSha256 ||
      payload.tableCount !== envelope.header.tableCount ||
      payload.rowCount !== envelope.header.rowCount
    ) {
      throw new Error('Portable backup header does not match its payload.');
    }
    return Object.freeze({
      archiveSha256: sha256(archive),
      contentSha256: envelope.header.contentSha256,
      header: Object.freeze({ ...envelope.header }),
      payload,
    });
  } catch (error) {
    if (/Portable backup/.test(error.message)) throw error;
    throw new Error('Portable backup authentication or decompression failed.', { cause: error });
  }
}

function comparableContract(table) {
  return {
    columns: table.columns,
    foreignKeys: table.foreignKeys,
    name: table.name,
    primaryKey: table.primaryKey,
  };
}

function restoreOrder(tables) {
  const dependencies = new Map();
  for (const table of tables) {
    dependencies.set(
      table.name,
      new Map(
        table.foreignKeys.map((foreignKey) => [
          `${foreignKey.column}:${foreignKey.parentTable}`,
          foreignKey,
        ]),
      ),
    );
  }
  const ordered = [];
  const inserted = new Set();
  const deferredColumns = new Map();
  const pathExists = (from, target, visited = new Set()) => {
    if (from === target) return true;
    if (visited.has(from) || inserted.has(from)) return false;
    visited.add(from);
    for (const dependency of dependencies.get(from)?.values() || []) {
      if (pathExists(dependency.parentTable, target, visited)) return true;
    }
    return false;
  };
  while (ordered.length < tables.length) {
    const ready = tables
      .map((table) => table.name)
      .filter((name) => !inserted.has(name))
      .filter((name) =>
        [...dependencies.get(name).values()].every((dependency) =>
          inserted.has(dependency.parentTable),
        ),
      )
      .sort();
    if (ready.length) {
      for (const name of ready) {
        inserted.add(name);
        ordered.push(name);
      }
      continue;
    }
    const breakable = [];
    for (const [tableName, tableDependencies] of dependencies) {
      if (inserted.has(tableName)) continue;
      for (const [key, dependency] of tableDependencies) {
        if (
          dependency.nullable &&
          !inserted.has(dependency.parentTable) &&
          SAFE_DEFERRED_FOREIGN_KEYS.has(`${tableName}.${dependency.column}`) &&
          pathExists(dependency.parentTable, tableName)
        ) {
          breakable.push({ dependency, key, tableName });
        }
      }
    }
    if (!breakable.length) throw new Error('Portable restore found a non-null foreign-key cycle.');
    breakable.sort((left, right) =>
      `${left.tableName}.${left.dependency.column}`.localeCompare(
        `${right.tableName}.${right.dependency.column}`,
      ),
    );
    const item = breakable[0];
    dependencies.get(item.tableName).delete(item.key);
    const columns = deferredColumns.get(item.tableName) || new Set();
    columns.add(item.dependency.column);
    deferredColumns.set(item.tableName, columns);
  }
  return Object.freeze({ deferredColumns, ordered: Object.freeze(ordered) });
}

async function assertAppliedMigrations(client, expected) {
  const result = await client.query(
    `SELECT migration_name FROM _prisma_migrations
     WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
     ORDER BY started_at, migration_name`,
  );
  if (JSON.stringify(result.rows.map((row) => row.migration_name)) !== JSON.stringify(expected)) {
    throw new Error('Restore target migrations do not exactly match the backup.');
  }
}

async function assertEmptyTables(client, tables) {
  for (const table of tables) {
    const bootstrapKeys = MIGRATION_BOOTSTRAP_ROWS[table.name];
    if (bootstrapKeys) {
      const result = await client.query(
        `SELECT key FROM ${quoteIdentifier(table.name)} ORDER BY key`,
      );
      const actual = result.rows.map((row) => row.key);
      if (JSON.stringify(actual) !== JSON.stringify([...bootstrapKeys].sort())) {
        throw new Error(`Restore target contains unexpected rows: ${table.name}`);
      }
      await client.query(`DELETE FROM ${quoteIdentifier(table.name)} WHERE key = ANY($1::text[])`, [
        bootstrapKeys,
      ]);
      continue;
    }
    const result = await client.query(
      `SELECT EXISTS (SELECT 1 FROM ${quoteIdentifier(table.name)} LIMIT 1) AS present`,
    );
    if (result.rows[0].present) throw new Error(`Restore target table is not empty: ${table.name}`);
  }
}

async function insertTable(client, table, deferredColumns) {
  if (!table.rows.length) return [];
  const names = table.columns.map((column) => column.name);
  const columns = names.map(quoteIdentifier).join(', ');
  const parameters = names.map((_, index) => `$${index + 1}`).join(', ');
  const deferredUpdates = [];
  for (const sourceRow of table.rows) {
    const row = [...sourceRow];
    for (const columnName of deferredColumns || []) {
      const index = names.indexOf(columnName);
      if (row[index] !== null) {
        deferredUpdates.push({ columnName, row: sourceRow, table, value: row[index] });
        row[index] = null;
      }
    }
    await client.query(
      `INSERT INTO ${quoteIdentifier(table.name)} (${columns}) VALUES (${parameters})`,
      row,
    );
  }
  return deferredUpdates;
}

async function applyDeferredUpdate(client, update) {
  const names = update.table.columns.map((column) => column.name);
  const predicates = update.table.primaryKey.map(
    (columnName, index) => `${quoteIdentifier(columnName)} = $${index + 2}`,
  );
  const primaryValues = update.table.primaryKey.map(
    (columnName) => update.row[names.indexOf(columnName)],
  );
  await client.query(
    `UPDATE ${quoteIdentifier(update.table.name)}
     SET ${quoteIdentifier(update.columnName)} = $1
     WHERE ${predicates.join(' AND ')}`,
    [update.value, ...primaryValues],
  );
}

async function restorePortableSnapshot(pool, payload, manifest) {
  if (payload.schemaSha256 !== manifest.schema.sha256) {
    throw new Error('Backup schema checksum does not match the repository manifest.');
  }
  const manifestMigrations = manifest.migrations.map((migration) => migration.name);
  if (JSON.stringify(payload.migrations) !== JSON.stringify(manifestMigrations)) {
    throw new Error('Backup migration list does not match the repository manifest.');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    await client.query(`SET LOCAL TIME ZONE 'UTC'`);
    await client.query('SET CONSTRAINTS ALL DEFERRED');
    await assertAppliedMigrations(client, payload.migrations);
    const targetContracts = [];
    for (const tableName of await listTableNames(client)) {
      targetContracts.push(await tableContract(client, tableName));
    }
    if (
      JSON.stringify(targetContracts.map(comparableContract)) !==
      JSON.stringify(payload.tables.map(comparableContract))
    ) {
      throw new Error('Restore target table contract does not match the backup.');
    }
    await assertEmptyTables(client, payload.tables);

    const plan = restoreOrder(payload.tables);
    const byName = new Map(payload.tables.map((table) => [table.name, table]));
    const deferredUpdates = [];
    for (const tableName of plan.ordered) {
      deferredUpdates.push(
        ...(await insertTable(client, byName.get(tableName), plan.deferredColumns.get(tableName))),
      );
    }
    for (const update of deferredUpdates) await applyDeferredUpdate(client, update);

    const restored = await readPortableSnapshot(client, manifest);
    const restoredSha256 = sha256(Buffer.from(JSON.stringify(restored)));
    const expectedSha256 = sha256(Buffer.from(JSON.stringify(payload)));
    if (restoredSha256 !== expectedSha256) {
      throw new Error('Restored database content does not match the authenticated backup.');
    }
    await client.query('COMMIT');
    return Object.freeze({
      contentSha256: expectedSha256,
      rowCount: restored.rowCount,
      tableCount: restored.tableCount,
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  ARCHIVE_FORMAT,
  DEFAULT_MAX_PLAINTEXT_BYTES,
  PAYLOAD_FORMAT,
  createPortableArchive,
  exportPortableSnapshot,
  openPortableArchive,
  parseBackupKey,
  readPortableSnapshot,
  restoreOrder,
  restorePortableSnapshot,
  sha256,
};
