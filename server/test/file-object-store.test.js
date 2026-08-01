'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createS3ObjectStore,
  downloadDisposition,
  requiredUploadHeaders,
} = require('../modules/files/object-store');
const { loadFileStorageConfig } = require('../modules/files/runtime');

const record = Object.freeze({
  byteSize: 12,
  declaredMime: 'image/png',
  detectedMime: 'image/png',
  id: '11111111-1111-4111-8111-111111111111',
  originalName: 'résumé image.png',
  sha256: 'ab'.repeat(32),
  storageKey: 'codewithmee/test/profile_avatar/2026/08/file-id',
});

test('S3 adapter signs constrained private PUT/GET commands and maps HEAD metadata', async () => {
  const sent = [];
  const signed = [];
  const client = {
    destroy() {},
    async send(command) {
      sent.push(command);
      if (command.constructor.name === 'HeadObjectCommand') {
        return {
          ChecksumSHA256: Buffer.from(record.sha256, 'hex').toString('base64'),
          ContentLength: record.byteSize,
          ContentType: record.declaredMime,
          ETag: '"fixture-etag"',
          Metadata: { 'file-id': record.id, sha256: record.sha256 },
        };
      }
      return {};
    },
  };
  const store = createS3ObjectStore(
    {
      bucket: 'private-bucket',
      downloadTtlSeconds: 45,
      forcePathStyle: false,
      prefix: 'codewithmee/test',
      region: 'auto',
      uploadTtlSeconds: 180,
    },
    {
      client,
      async presign(_client, command, options) {
        signed.push({ command, options });
        return `https://objects.example.test/${command.constructor.name}`;
      },
    },
  );

  const upload = await store.createUploadUrl(record);
  assert.equal(upload.method, 'PUT');
  assert.equal(upload.requiredHeaders['content-length'], '12');
  assert.equal(signed[0].command.constructor.name, 'PutObjectCommand');
  assert.deepEqual(signed[0].command.input.Metadata, {
    'file-id': record.id,
    sha256: record.sha256,
  });
  assert.equal(signed[0].command.input.ACL, undefined);
  assert.equal(signed[0].options.expiresIn, 180);

  const head = await store.headObject(record);
  assert.equal(head.byteSize, 12);
  assert.equal(head.etag, 'fixture-etag');
  assert.deepEqual(head.metadata, { 'file-id': record.id, sha256: record.sha256 });

  const download = await store.createDownloadUrl(record);
  assert.equal(download.method, 'GET');
  assert.equal(signed[1].command.constructor.name, 'GetObjectCommand');
  assert.equal(
    signed[1].command.input.ResponseContentDisposition,
    "attachment; filename*=UTF-8''r%C3%A9sum%C3%A9%20image.png",
  );
  await store.deleteObject(record);
  assert.equal(sent.at(-1).constructor.name, 'DeleteObjectCommand');
  assert.deepEqual(requiredUploadHeaders(record), upload.requiredHeaders);
  assert.equal(downloadDisposition("a'b.txt"), "attachment; filename*=UTF-8''a%27b.txt");
});

test('S3 adapter treats provider 404 as an absent object but propagates other failures', async () => {
  const absent = createS3ObjectStore(
    {
      bucket: 'private-bucket',
      downloadTtlSeconds: 45,
      forcePathStyle: false,
      prefix: 'codewithmee/test',
      region: 'auto',
      uploadTtlSeconds: 180,
    },
    {
      client: {
        async send() {
          const error = new Error('not found');
          error.$metadata = { httpStatusCode: 404 };
          throw error;
        },
      },
    },
  );
  assert.equal(await absent.headObject(record), null);
});

test('file runtime configuration is all-or-none and production requires HTTPS plus scanning', () => {
  assert.deepEqual(loadFileStorageConfig({}), {
    enabled: false,
    reason: 'file_storage_not_configured',
  });
  assert.throws(
    () =>
      loadFileStorageConfig({
        FILE_STORAGE_BUCKET: 'bucket',
        FILE_STORAGE_MODE: 's3',
      }),
    /REGION is required/,
  );
  assert.throws(
    () =>
      loadFileStorageConfig({
        FILE_STORAGE_BUCKET: 'Bad_Bucket',
        FILE_STORAGE_MODE: 's3',
        FILE_STORAGE_REGION: 'auto',
      }),
    /DNS-compatible/,
  );
  assert.throws(
    () =>
      loadFileStorageConfig({
        FILE_STORAGE_BUCKET: 'private-bucket',
        FILE_STORAGE_MODE: 's3',
        FILE_STORAGE_PREFIX: 'codewithmee//production',
        FILE_STORAGE_REGION: 'auto',
      }),
    /unsafe segment/,
  );
  assert.throws(
    () =>
      loadFileStorageConfig({
        FILE_SCANNER_MODE: 'external',
        FILE_STORAGE_ACCESS_KEY_ID: 'one-sided',
        FILE_STORAGE_BUCKET: 'bucket',
        FILE_STORAGE_MODE: 's3',
        FILE_STORAGE_REGION: 'auto',
      }),
    /must be set together/,
  );
  assert.throws(
    () =>
      loadFileStorageConfig(
        {
          FILE_SCANNER_MODE: 'external',
          FILE_STORAGE_BUCKET: 'bucket',
          FILE_STORAGE_ENDPOINT: 'http://objects.example.test',
          FILE_STORAGE_MODE: 's3',
          FILE_STORAGE_REGION: 'auto',
        },
        { nodeEnv: 'production' },
      ),
    /HTTPS in production/,
  );
  assert.throws(
    () =>
      loadFileStorageConfig(
        {
          FILE_STORAGE_BUCKET: 'bucket',
          FILE_STORAGE_ENDPOINT: 'https://objects.example.test',
          FILE_STORAGE_MODE: 's3',
          FILE_STORAGE_REGION: 'auto',
        },
        { nodeEnv: 'production' },
      ),
    /SCANNER_MODE must be external/,
  );
  const configured = loadFileStorageConfig(
    {
      FILE_SCANNER_MODE: 'external',
      FILE_STORAGE_BUCKET: 'bucket',
      FILE_STORAGE_ENDPOINT: 'https://objects.example.test/',
      FILE_STORAGE_MODE: 's3',
      FILE_STORAGE_REGION: 'auto',
    },
    { nodeEnv: 'production' },
  );
  assert.equal(configured.enabled, true);
  assert.equal(configured.endpoint, 'https://objects.example.test');
  assert.equal(configured.prefix, 'codewithmee/production');
});
