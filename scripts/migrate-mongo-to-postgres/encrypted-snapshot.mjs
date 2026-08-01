import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { COLLECTION_NAMES, MIGRATION_SCHEMA_VERSION } from './collection-registry.mjs';
import { canonicalize, fingerprint, sha256, stableStringify } from './canonical-json.mjs';

const SNAPSHOT_KIND = 'codewithmee-encrypted-mongo-export';

/** @param {string} filePath */
async function hashFile(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

/** @param {string} directory */
async function createExclusiveDirectory(directory) {
  const absolute = path.resolve(directory);
  await mkdir(path.dirname(absolute), { recursive: true });
  await mkdir(absolute, { mode: 0o700, recursive: false });
  return absolute;
}

/**
 * @param {string} collectionName
 * @param {number} recordIndex
 */
function associatedData(collectionName, recordIndex) {
  return Buffer.from(
    `${SNAPSHOT_KIND}:${MIGRATION_SCHEMA_VERSION}:${collectionName}:${recordIndex}`,
    'utf8',
  );
}

/**
 * @param {{
 *   collectionName: string,
 *   key: Buffer,
 *   outputDirectory: string,
 *   source: import('./types.mjs').MigrationSource
 * }} options
 */
async function writeEncryptedCollection({ collectionName, key, outputDirectory, source }) {
  const fileName = `${collectionName}.ndjson.aes256gcm`;
  const filePath = path.join(outputDirectory, fileName);
  const output = createWriteStream(filePath, { flags: 'wx', mode: 0o600 });

  const plaintextHash = createHash('sha256');
  let count = 0;
  let plaintextBytes = 0;
  try {
    for await (const document of source.iterateCollection(collectionName)) {
      const line = `${stableStringify(document)}\n`;
      const plaintext = Buffer.from(line, 'utf8');
      const initializationVector = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, initializationVector);
      cipher.setAAD(associatedData(collectionName, count));
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const frame = `${JSON.stringify({
        ciphertext: ciphertext.toString('base64'),
        initializationVector: initializationVector.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
      })}\n`;
      plaintextHash.update(plaintext);
      plaintextBytes += plaintext.length;
      count += 1;
      if (!output.write(frame)) await once(output, 'drain');
    }
    output.end();
    await finished(output);
  } catch (error) {
    const streamError = error instanceof Error ? error : new Error('Snapshot stream failed');
    output.destroy(streamError);
    throw error;
  }

  const fileStats = await stat(filePath);
  return {
    ciphertextBytes: fileStats.size,
    ciphertextSha256: await hashFile(filePath),
    count,
    file: fileName,
    plaintextBytes,
    plaintextSha256: plaintextHash.digest('hex'),
  };
}

/** @param {import('./types.mjs').SnapshotManifest} manifest */
function manifestWithoutAuthenticators(manifest) {
  const {
    manifestHmacSha256: _ignoredHmac,
    manifestSha256: _ignoredChecksum,
    ...unsigned
  } = manifest;
  return unsigned;
}

/**
 * @param {{
 *   clock?: () => Date,
 *   encryptionKey: Buffer,
 *   fingerprintKey: Buffer,
 *   outputDirectory: string,
 *   source: import('./types.mjs').MigrationSource
 * }} options
 */
export async function exportEncryptedSnapshot({
  clock = () => new Date(),
  encryptionKey,
  fingerprintKey,
  outputDirectory,
  source,
}) {
  const available = new Set(await source.listCollections());
  const unexpected = [...available].filter((name) => !COLLECTION_NAMES.includes(name)).sort();
  if (unexpected.length > 0) {
    throw new Error(
      `Encrypted export refused ${unexpected.length} unregistered source collection(s); inventory and review first`,
    );
  }
  const absoluteOutput = await createExclusiveDirectory(outputDirectory);
  /** @type {Array<any>} */
  const collections = [];
  for (const collectionName of COLLECTION_NAMES) {
    const result = await writeEncryptedCollection({
      collectionName,
      key: encryptionKey,
      outputDirectory: absoluteOutput,
      source,
    });
    collections.push({
      ...result,
      existedAtSource: available.has(collectionName),
      name: collectionName,
    });
  }

  const datasetSha256 = sha256(
    collections
      .map((entry) => `${entry.name}:${entry.count}:${entry.plaintextSha256}`)
      .sort()
      .join('\n'),
  );
  const manifest = canonicalize({
    collections,
    createdAt: clock().toISOString(),
    datasetSha256,
    encryption: {
      algorithm: 'aes-256-gcm',
      framing: 'authenticated-record-v1',
      keyFingerprint: sha256(encryptionKey).slice(0, 16),
    },
    kind: SNAPSHOT_KIND,
    schemaVersion: MIGRATION_SCHEMA_VERSION,
    source: {
      databaseFingerprint: fingerprint(source.databaseLabel, fingerprintKey),
      kind: source.kind,
      readOnlyRoles: (source.roles || []).map((entry) => entry.role).sort(),
    },
  });
  const manifestSha256 = sha256(stableStringify(manifest));
  const manifestHmacSha256 = fingerprint(
    stableStringify({ ...manifest, manifestSha256 }),
    encryptionKey,
  );
  /** @type {import('./types.mjs').SnapshotManifest} */
  const signedManifest = {
    ...manifest,
    manifestHmacSha256,
    manifestSha256,
  };
  await writeFile(
    path.join(absoluteOutput, 'manifest.json'),
    `${JSON.stringify(signedManifest, null, 2)}\n`,
    { encoding: 'utf8', flag: 'wx', mode: 0o600 },
  );
  return { directory: absoluteOutput, manifest: signedManifest };
}

/**
 * @param {string} snapshotDirectory
 * @param {Buffer} encryptionKey
 */
async function loadManifest(snapshotDirectory, encryptionKey) {
  const absolute = await realpath(path.resolve(snapshotDirectory));
  /** @type {import('./types.mjs').SnapshotManifest} */
  const manifest = JSON.parse(await readFile(path.join(absolute, 'manifest.json'), 'utf8'));
  if (manifest.kind !== SNAPSHOT_KIND || manifest.schemaVersion !== MIGRATION_SCHEMA_VERSION) {
    throw new Error('Unsupported migration snapshot kind or schema version');
  }
  if (
    manifest.encryption?.algorithm !== 'aes-256-gcm' ||
    manifest.encryption?.framing !== 'authenticated-record-v1'
  ) {
    throw new Error('Unsupported migration snapshot encryption format');
  }
  const unsigned = manifestWithoutAuthenticators(manifest);
  const expected = sha256(stableStringify(unsigned));
  if (manifest.manifestSha256 !== expected)
    throw new Error('Migration snapshot manifest checksum mismatch');
  const expectedHmac = fingerprint(
    stableStringify({ ...unsigned, manifestSha256: manifest.manifestSha256 }),
    encryptionKey,
  );
  if (manifest.manifestHmacSha256 !== expectedHmac) {
    throw new Error('Migration snapshot manifest authentication failed');
  }
  return { absolute, manifest };
}

/**
 * @param {string} directory
 * @param {string} fileName
 */
function resolveSnapshotFile(directory, fileName) {
  if (typeof fileName !== 'string' || path.basename(fileName) !== fileName) {
    throw new Error('Unsafe migration snapshot file name');
  }
  const resolved = path.resolve(directory, fileName);
  if (path.dirname(resolved) !== directory) throw new Error('Snapshot file escaped its directory');
  return resolved;
}

/**
 * @param {{ encryptionKey: Buffer, snapshotDirectory: string }} options
 * @returns {Promise<import('./types.mjs').MigrationSource>}
 */
export async function openEncryptedSnapshot({ encryptionKey, snapshotDirectory }) {
  const { absolute, manifest } = await loadManifest(snapshotDirectory, encryptionKey);
  const byName = new Map(manifest.collections.map((entry) => [entry.name, entry]));

  return {
    databaseLabel: manifest.source.databaseFingerprint,
    kind: 'encrypted_snapshot',
    manifest,
    async close() {},
    async listCollections() {
      return manifest.collections
        .filter((entry) => entry.existedAtSource)
        .map((entry) => entry.name);
    },
    async listIndexes() {
      return [];
    },
    async *iterateCollection(collectionName) {
      const entry = byName.get(collectionName);
      if (!entry)
        throw new Error(`Snapshot does not contain registered collection ${collectionName}`);
      const filePath = resolveSnapshotFile(absolute, entry.file);
      if ((await hashFile(filePath)) !== entry.ciphertextSha256) {
        throw new Error(`Ciphertext checksum mismatch for ${collectionName}`);
      }

      const input = createReadStream(filePath);
      const lines = readline.createInterface({ crlfDelay: Infinity, input });
      const plaintextHash = createHash('sha256');
      let count = 0;
      try {
        for await (const frameLine of lines) {
          if (frameLine.length === 0) continue;
          const frame = JSON.parse(frameLine);
          if (
            typeof frame.ciphertext !== 'string' ||
            typeof frame.initializationVector !== 'string' ||
            typeof frame.tag !== 'string'
          ) {
            throw new Error(`Invalid encrypted frame for ${collectionName}`);
          }
          const decipher = createDecipheriv(
            'aes-256-gcm',
            encryptionKey,
            Buffer.from(frame.initializationVector, 'base64'),
          );
          decipher.setAAD(associatedData(collectionName, count));
          decipher.setAuthTag(Buffer.from(frame.tag, 'base64'));
          const plaintext = Buffer.concat([
            decipher.update(Buffer.from(frame.ciphertext, 'base64')),
            decipher.final(),
          ]);
          if (plaintext.at(-1) !== 0x0a) {
            throw new Error(`Invalid authenticated record boundary for ${collectionName}`);
          }
          plaintextHash.update(plaintext);
          count += 1;
          yield JSON.parse(plaintext.subarray(0, -1).toString('utf8'));
        }
      } finally {
        lines.close();
        input.destroy();
      }
      if (count !== entry.count || plaintextHash.digest('hex') !== entry.plaintextSha256) {
        throw new Error(`Plaintext checksum/count mismatch for ${collectionName}`);
      }
    },
  };
}

export { SNAPSHOT_KIND };
