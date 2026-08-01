import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { canonicalize, sourceIdentifier, stableStringify } from './canonical-json.mjs';

/**
 * @param {string} fixturePath
 * @returns {Promise<import('./types.mjs').MigrationSource>}
 */
export async function createFixtureSource(fixturePath) {
  const absolutePath = path.resolve(fixturePath);
  /** @type {any} */
  const fixture = JSON.parse(await readFile(absolutePath, 'utf8'));
  if (!fixture || fixture.schemaVersion !== 1 || typeof fixture.collections !== 'object') {
    throw new Error('Migration fixture must have schemaVersion 1 and a collections object');
  }

  return {
    databaseLabel: fixture.databaseLabel || 'fixture',
    kind: 'fixture',
    async close() {},
    async *iterateCollection(collectionName) {
      const records = fixture.collections[collectionName] || [];
      const sorted = [...records]
        .map((/** @type {any} */ record) => canonicalize(record))
        .sort((left, right) => {
          const leftId = sourceIdentifier(left._id) || stableStringify(left);
          const rightId = sourceIdentifier(right._id) || stableStringify(right);
          return leftId.localeCompare(rightId);
        });
      for (const record of sorted) yield record;
    },
    async listCollections() {
      return Object.keys(fixture.collections).sort();
    },
    async listIndexes(collectionName) {
      return canonicalize(fixture.indexes?.[collectionName] || []);
    },
  };
}
