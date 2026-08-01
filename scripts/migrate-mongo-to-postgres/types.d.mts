export type LegacyDocument = Record<string, any>;

export interface MigrationRole {
  database: string;
  role: string;
}

export interface MigrationSource {
  databaseLabel: string;
  kind: string;
  roles?: MigrationRole[];
  manifest?: {
    datasetSha256?: string;
    [key: string]: any;
  };
  close(): Promise<void> | void;
  iterateCollection(collectionName: string): AsyncIterable<LegacyDocument>;
  listCollections(): Promise<string[]>;
  listIndexes(collectionName: string): Promise<LegacyDocument[]>;
}

export interface CollectionDefinition {
  collection: string;
  modelFile: string;
  sensitiveFields: readonly string[];
  targets: readonly string[];
}

export interface SnapshotCollection {
  ciphertextBytes: number;
  ciphertextSha256: string;
  count: number;
  existedAtSource: boolean;
  file: string;
  name: string;
  plaintextBytes: number;
  plaintextSha256: string;
}

export interface SnapshotManifest {
  collections: SnapshotCollection[];
  createdAt: string;
  datasetSha256: string;
  encryption: {
    algorithm: string;
    framing: string;
    keyFingerprint: string;
  };
  kind: string;
  manifestHmacSha256: string;
  manifestSha256: string;
  schemaVersion: number;
  source: {
    databaseFingerprint: string;
    kind: string;
    readOnlyRoles: string[];
  };
}

export interface PlanEntry {
  metadata: LegacyDocument;
  sourceCollection: string;
  sourceIdFingerprint: string | null;
  state: 'planned' | 'quarantined';
  targetId: string | null;
  targetType: string;
}

export interface MigrationException {
  code: string;
  collection: string;
  fields: string[];
  message: string;
  severity: 'warning' | 'error' | 'fatal';
  sourceIdFingerprint: string | null;
}

export interface DryRunReport extends LegacyDocument {
  exceptions: MigrationException[];
  planSha256: string;
  writesPerformed: false;
}

export type CliOptions = {
  dryRun?: boolean;
  [key: string]: string | boolean | undefined;
};
