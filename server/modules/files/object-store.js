'use strict';

const { createHash, randomUUID } = require('node:crypto');

const {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const { checksumBase64 } = require('./contracts');

function requiredUploadHeaders(record) {
  return Object.freeze({
    'content-length': String(record.byteSize),
    'content-type': record.declaredMime,
    'x-amz-checksum-sha256': checksumBase64(record.sha256),
    'x-amz-meta-file-id': record.id,
    'x-amz-meta-sha256': record.sha256,
  });
}

function downloadDisposition(originalName) {
  const encoded = encodeURIComponent(originalName).replaceAll("'", '%27');
  return `attachment; filename*=UTF-8''${encoded}`;
}

function createS3ObjectStore(config, { client, presign = getSignedUrl } = {}) {
  const s3Client =
    client ||
    new S3Client({
      credentials: config.credentials,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      region: config.region,
    });

  return Object.freeze({
    basePrefix: config.prefix,
    bucket: config.bucket,
    provider: 's3',
    async close() {
      s3Client.destroy?.();
    },
    async createDownloadUrl(record) {
      const command = new GetObjectCommand({
        Bucket: config.bucket,
        Key: record.storageKey,
        ResponseContentDisposition: downloadDisposition(record.originalName),
        ResponseContentType: record.detectedMime,
      });
      return Object.freeze({
        expiresAt: new Date(Date.now() + config.downloadTtlSeconds * 1000),
        method: 'GET',
        url: await presign(s3Client, command, { expiresIn: config.downloadTtlSeconds }),
      });
    },
    async createUploadUrl(record) {
      const headers = requiredUploadHeaders(record);
      const command = new PutObjectCommand({
        Bucket: config.bucket,
        ChecksumSHA256: headers['x-amz-checksum-sha256'],
        ContentLength: record.byteSize,
        ContentType: record.declaredMime,
        Key: record.storageKey,
        Metadata: { 'file-id': record.id, sha256: record.sha256 },
      });
      return Object.freeze({
        expiresAt: new Date(Date.now() + config.uploadTtlSeconds * 1000),
        method: 'PUT',
        requiredHeaders: headers,
        url: await presign(s3Client, command, {
          expiresIn: config.uploadTtlSeconds,
          signableHeaders: new Set(['content-length', 'content-type']),
        }),
      });
    },
    async deleteObject(record) {
      await s3Client.send(
        new DeleteObjectCommand({ Bucket: config.bucket, Key: record.storageKey }),
      );
    },
    async headObject(record) {
      try {
        const result = await s3Client.send(
          new HeadObjectCommand({
            Bucket: config.bucket,
            ChecksumMode: 'ENABLED',
            Key: record.storageKey,
          }),
        );
        return Object.freeze({
          byteSize: Number(result.ContentLength),
          checksumBase64: result.ChecksumSHA256 || null,
          contentType: result.ContentType || null,
          etag: result.ETag ? String(result.ETag).replace(/^"|"$/g, '') : null,
          metadata: Object.freeze({ ...(result.Metadata || {}) }),
        });
      } catch (error) {
        if (
          error?.name === 'NotFound' ||
          error?.name === 'NoSuchKey' ||
          error?.$metadata?.httpStatusCode === 404
        ) {
          return null;
        }
        throw error;
      }
    },
    async listObjects({ maxObjects = 100_000 } = {}) {
      if (!Number.isInteger(maxObjects) || maxObjects < 1 || maxObjects > 1_000_000) {
        throw new Error('Object inventory limit must be between 1 and 1000000.');
      }
      const objects = [];
      let continuationToken;
      do {
        const result = await s3Client.send(
          new ListObjectsV2Command({
            Bucket: config.bucket,
            ContinuationToken: continuationToken,
            Prefix: `${config.prefix}/`,
          }),
        );
        for (const object of result.Contents || []) {
          if (!object.Key) continue;
          objects.push(
            Object.freeze({
              byteSize: Number(object.Size),
              etag: object.ETag ? String(object.ETag).replace(/^"|"$/g, '') : null,
              key: object.Key,
              lastModified: object.LastModified || null,
            }),
          );
          if (objects.length > maxObjects) throw new Error('Object inventory limit exceeded.');
        }
        continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
        if (result.IsTruncated && !continuationToken) {
          throw new Error(
            'Object provider returned a truncated page without a continuation token.',
          );
        }
      } while (continuationToken);
      return Object.freeze(objects.sort((left, right) => left.key.localeCompare(right.key)));
    },
  });
}

function createMemoryObjectStore({
  basePrefix = 'codewithmee/test',
  bucket = 'private-test-bucket',
  clock = () => new Date(),
  downloadTtlSeconds = 60,
  uploadTtlSeconds = 300,
} = {}) {
  const intents = new Map();
  const objects = new Map();

  function objectMetadata(record, body, overrides = {}) {
    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
    const actualSha256 = createHash('sha256').update(bytes).digest('hex');
    return Object.freeze({
      body: bytes,
      byteSize: overrides.byteSize ?? bytes.length,
      checksumBase64:
        overrides.checksumBase64 ?? Buffer.from(actualSha256, 'hex').toString('base64'),
      contentType: overrides.contentType ?? record.declaredMime,
      etag: overrides.etag ?? createHash('md5').update(bytes).digest('hex'),
      metadata: Object.freeze({
        'file-id': overrides.fileId ?? record.id,
        sha256: overrides.sha256 ?? record.sha256,
      }),
    });
  }

  return Object.freeze({
    basePrefix,
    bucket,
    provider: 'memory',
    async acceptUpload(fileId, body, overrides = {}) {
      const record = intents.get(fileId);
      if (!record) throw new Error('Unknown or expired memory upload intent');
      const metadata = objectMetadata(record, body, overrides);
      if (
        metadata.byteSize !== record.byteSize ||
        metadata.contentType !== record.declaredMime ||
        metadata.checksumBase64 !== checksumBase64(record.sha256)
      ) {
        throw new Error('Memory upload did not satisfy its signed constraints');
      }
      objects.set(record.storageKey, metadata);
    },
    async close() {},
    async createDownloadUrl(record) {
      if (!objects.has(record.storageKey)) throw new Error('Memory object is absent');
      return Object.freeze({
        expiresAt: new Date(clock().getTime() + downloadTtlSeconds * 1000),
        method: 'GET',
        url: `https://objects.invalid/download/${randomUUID()}`,
      });
    },
    async createUploadUrl(record) {
      intents.set(record.id, structuredClone(record));
      return Object.freeze({
        expiresAt: new Date(clock().getTime() + uploadTtlSeconds * 1000),
        method: 'PUT',
        requiredHeaders: requiredUploadHeaders(record),
        url: `https://objects.invalid/upload/${randomUUID()}`,
      });
    },
    async deleteObject(record) {
      objects.delete(record.storageKey);
      intents.delete(record.id);
    },
    async hasObject(record) {
      return objects.has(record.storageKey);
    },
    async headObject(record) {
      const object = objects.get(record.storageKey);
      if (!object) return null;
      const { body: _body, ...metadata } = object;
      return structuredClone(metadata);
    },
    async listObjects({ maxObjects = 100_000 } = {}) {
      if (objects.size > maxObjects) throw new Error('Object inventory limit exceeded.');
      return Object.freeze(
        [...objects.entries()]
          .map(([key, object]) =>
            Object.freeze({
              byteSize: object.byteSize,
              etag: object.etag,
              key,
              lastModified: null,
            }),
          )
          .sort((left, right) => left.key.localeCompare(right.key)),
      );
    },
    async putUncheckedForTest(record, body, overrides = {}) {
      objects.set(record.storageKey, objectMetadata(record, body, overrides));
    },
  });
}

module.exports = {
  createMemoryObjectStore,
  createS3ObjectStore,
  downloadDisposition,
  requiredUploadHeaders,
};
