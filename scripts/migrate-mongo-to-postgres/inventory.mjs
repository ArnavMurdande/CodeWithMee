import { createHash } from 'node:crypto';
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
import { inventoryUploads } from './upload-inventory.mjs';

/** @param {import('./types.mjs').LegacyDocument[]} indexes */
function sanitizedIndexes(indexes) {
  return canonicalize(
    indexes.map((index) => ({
      expireAfterSeconds: index.expireAfterSeconds ?? null,
      key: index.key ?? {},
      nameFingerprint:
        typeof index.name === 'string'
          ? sha256(Buffer.from(index.name, 'utf8')).slice(0, 16)
          : null,
      partialFilterFields:
        index.partialFilterExpression && typeof index.partialFilterExpression === 'object'
          ? Object.keys(index.partialFilterExpression).sort()
          : [],
      sparse: index.sparse === true,
      unique: index.unique === true,
    })),
  );
}

/**
 * @param {{
 *   clock?: () => Date,
 *   fingerprintKey: Buffer,
 *   source: import('./types.mjs').MigrationSource,
 *   uploadRoot?: string
 * }} options
 */
export async function buildInventory({
  clock = () => new Date(),
  fingerprintKey,
  source,
  uploadRoot,
}) {
  const actualCollections = await source.listCollections();
  const actualSet = new Set(actualCollections);
  /** @type {Array<import('./types.mjs').LegacyDocument>} */
  const collections = [];
  /** @type {Array<import('./types.mjs').LegacyDocument>} */
  const exceptions = [];

  for (const collectionName of COLLECTION_NAMES) {
    const definition = COLLECTION_BY_NAME.get(collectionName);
    if (!definition) throw new Error(`Missing migration registry entry for ${collectionName}`);
    const hash = createHash('sha256');
    /** @type {Map<string, number>} */
    const fields = new Map();
    let count = 0;
    let maximumDocumentBytes = 0;
    let missingIdentifierCount = 0;

    for await (const document of source.iterateCollection(collectionName)) {
      const canonical = canonicalize(document);
      const line = `${stableStringify(canonical)}\n`;
      const bytes = Buffer.byteLength(line);
      hash.update(line);
      count += 1;
      maximumDocumentBytes = Math.max(maximumDocumentBytes, bytes);
      if (!sourceIdentifier(canonical._id)) missingIdentifierCount += 1;
      for (const key of Object.keys(canonical)) fields.set(key, (fields.get(key) || 0) + 1);
    }

    if (missingIdentifierCount > 0) {
      exceptions.push({
        code: 'missing_source_identifier',
        collection: collectionName,
        count: missingIdentifierCount,
        severity: 'fatal',
      });
    }
    if (maximumDocumentBytes > 1_000_000) {
      exceptions.push({
        code: 'large_source_document',
        collection: collectionName,
        maximumDocumentBytes,
        severity: maximumDocumentBytes >= 16_000_000 ? 'fatal' : 'warning',
      });
    }

    const indexes = sanitizedIndexes(await source.listIndexes(collectionName));
    collections.push({
      checksum: hash.digest('hex'),
      count,
      existedAtSource: actualSet.has(collectionName),
      fieldPresence: Object.fromEntries(
        [...fields.entries()].sort(([left], [right]) => left.localeCompare(right)),
      ),
      indexChecksum: sha256(stableStringify(indexes)),
      indexes,
      maximumDocumentBytes,
      name: collectionName,
      sensitiveFieldNames: [...definition.sensitiveFields].sort(),
      targets: [...definition.targets],
    });
  }

  const unexpectedCollections = actualCollections
    .filter((collectionName) => !COLLECTION_BY_NAME.has(collectionName))
    .sort();
  for (const collectionName of unexpectedCollections) {
    exceptions.push({
      code: 'unexpected_source_collection',
      collectionFingerprint: fingerprint(collectionName, fingerprintKey),
      severity: 'warning',
    });
  }

  const uploads = await inventoryUploads({ fingerprintKey, uploadRoot });
  const sourceDatasetSha256 = sha256(
    collections.map((entry) => `${entry.name}:${entry.count}:${entry.checksum}`).join('\n'),
  );
  return canonicalize({
    collections,
    createdAt: clock().toISOString(),
    exceptions: [...exceptions, ...uploads.exceptions],
    kind: 'codewithmee-source-inventory',
    schemaVersion: MIGRATION_SCHEMA_VERSION,
    source: {
      databaseFingerprint: fingerprint(source.databaseLabel, fingerprintKey),
      datasetSha256: sourceDatasetSha256,
      kind: source.kind,
      registeredCollectionCount: COLLECTION_NAMES.length,
      unexpectedCollectionCount: unexpectedCollections.length,
    },
    uploads,
  });
}
