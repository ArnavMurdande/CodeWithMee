import { createRequire } from 'node:module';
import { assertMongoSourceSafety, assertReadOnlyRoles } from './source-safety.mjs';

const requireFromServer = createRequire(new URL('../../server/package.json', import.meta.url));
/** @type {any} */
const mongoose = requireFromServer('mongoose');

/**
 * @param {NodeJS.ProcessEnv} environment
 * @returns {Promise<import('./types.mjs').MigrationSource>}
 */
export async function createMongoSource(environment = process.env) {
  const safety = assertMongoSourceSafety(environment);
  const connection = await mongoose
    .createConnection(safety.mongoUri, {
      autoCreate: false,
      autoIndex: false,
      maxPoolSize: 2,
      readConcern: { level: 'majority' },
      readPreference: 'primary',
      serverSelectionTimeoutMS: 10_000,
    })
    .asPromise();

  try {
    const authentication = await connection.db.command({
      connectionStatus: 1,
      showPrivileges: true,
    });
    const roles = assertReadOnlyRoles(authentication);

    return {
      databaseLabel: safety.database,
      kind: 'mongo',
      roles,
      async close() {
        await connection.close(false);
      },
      async *iterateCollection(collectionName) {
        const cursor = connection.db
          .collection(collectionName)
          .find({}, { readConcern: { level: 'majority' }, readPreference: 'primary' })
          .sort({ _id: 1 })
          .batchSize(250)
          .maxTimeMS(60_000);
        for await (const document of cursor) yield document;
      },
      async listCollections() {
        const collections = await connection.db.listCollections({}, { nameOnly: true }).toArray();
        return collections.map((/** @type {any} */ entry) => entry.name).sort();
      },
      async listIndexes(collectionName) {
        const exists = await connection.db.listCollections({ name: collectionName }).hasNext();
        if (!exists) return [];
        return connection.db.collection(collectionName).listIndexes().toArray();
      },
    };
  } catch (error) {
    await connection.close(false).catch(() => undefined);
    throw error;
  }
}
