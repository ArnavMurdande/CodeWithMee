'use strict';

const { createHash, randomBytes } = require('node:crypto');
const fs = require('node:fs');
const { mkdir, open, readFile, rename, rm, stat } = require('node:fs/promises');
const path = require('node:path');
const express = require('express');

const { FILE_SCAN_STATUS } = require('./contracts');
const { downloadDisposition } = require('./object-store');

const EICAR_MARKER = 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE';

function token() {
  return randomBytes(32).toString('base64url');
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function safeObjectPath(root, storageKey) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...String(storageKey).split('/'));
  if (!resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error('Unsafe local object key.');
  }
  return resolved;
}

function findZipEnd(bytes) {
  const minimum = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

function inspectZip(bytes) {
  const end = findZipEnd(bytes);
  if (end < 0) throw new Error('zip_end_record_missing');
  const entries = bytes.readUInt16LE(end + 10);
  const centralSize = bytes.readUInt32LE(end + 12);
  const centralOffset = bytes.readUInt32LE(end + 16);
  if (entries > 2_000 || centralSize > 16 * 1024 * 1024 || centralOffset + centralSize > end) {
    throw new Error('zip_structure_limit_exceeded');
  }
  let cursor = centralOffset;
  let totalUncompressed = 0;
  for (let index = 0; index < entries; index += 1) {
    if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error('zip_central_directory_invalid');
    }
    const flags = bytes.readUInt16LE(cursor + 8);
    const compressed = bytes.readUInt32LE(cursor + 20);
    const uncompressed = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const externalAttributes = bytes.readUInt32LE(cursor + 38);
    const endOfEntry = cursor + 46 + nameLength + extraLength + commentLength;
    if (endOfEntry > bytes.length || flags & 1) throw new Error('zip_entry_invalid');
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    const normalized = name.replaceAll('\\', '/');
    const segments = normalized.split('/').filter(Boolean);
    if (
      !normalized ||
      normalized.includes('\0') ||
      normalized.startsWith('/') ||
      /^[a-z]:/i.test(normalized) ||
      segments.includes('..')
    ) {
      throw new Error('zip_path_unsafe');
    }
    const unixMode = externalAttributes >>> 16;
    if ((unixMode & 0o170000) === 0o120000) throw new Error('zip_symlink_forbidden');
    if (uncompressed > 512 * 1024 * 1024 || (compressed === 0 ? uncompressed > 0 : uncompressed / compressed > 200)) {
      throw new Error('zip_expansion_limit_exceeded');
    }
    totalUncompressed += uncompressed;
    if (totalUncompressed > 1024 * 1024 * 1024) throw new Error('zip_total_limit_exceeded');
    cursor = endOfEntry;
  }
  if (cursor !== centralOffset + centralSize) throw new Error('zip_directory_size_mismatch');
}

function detectedMime(bytes, declaredMime) {
  if (declaredMime === 'application/pdf' && bytes.subarray(0, 5).toString() === '%PDF-') return declaredMime;
  if (declaredMime === 'application/zip' && bytes.length >= 4 && [0x04034b50, 0x06054b50].includes(bytes.readUInt32LE(0))) {
    inspectZip(bytes);
    return declaredMime;
  }
  if (declaredMime === 'application/json') {
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return declaredMime;
  }
  if (['text/plain', 'text/markdown'].includes(declaredMime)) {
    if (bytes.includes(0)) throw new Error('text_contains_nul');
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return declaredMime;
  }
  if (declaredMime === 'image/png' && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return declaredMime;
  if (declaredMime === 'image/jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9) return declaredMime;
  if (declaredMime === 'image/gif' && ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString())) return declaredMime;
  if (declaredMime === 'image/webp' && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return declaredMime;
  if (declaredMime === 'video/mp4' && bytes.subarray(4, 8).toString() === 'ftyp') return declaredMime;
  if (declaredMime === 'video/webm' && bytes.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex'))) return declaredMime;
  if (declaredMime === 'audio/ogg' && bytes.subarray(0, 4).toString() === 'OggS') return declaredMime;
  if (declaredMime === 'audio/wav' && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WAVE') return declaredMime;
  if (declaredMime === 'audio/mpeg' && (bytes.subarray(0, 3).toString() === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0))) return declaredMime;
  throw new Error('file_signature_mismatch');
}

function createLocalObjectStore(config) {
  const uploads = new Map();
  const downloads = new Map();
  const root = path.resolve(config.localRoot);

  function activeIntent(collection, rawToken) {
    const intent = collection.get(rawToken);
    if (!intent || intent.expiresAt.getTime() <= Date.now()) {
      collection.delete(rawToken);
      return null;
    }
    return intent;
  }

  async function headObject(record) {
    const objectPath = safeObjectPath(root, record.storageKey);
    try {
      const metadata = await stat(objectPath);
      if (!metadata.isFile()) return null;
      const bytes = await readFile(objectPath);
      const actualSha = sha256(bytes);
      return Object.freeze({
        byteSize: metadata.size,
        checksumBase64: Buffer.from(actualSha, 'hex').toString('base64'),
        contentType: record.declaredMime,
        etag: actualSha,
        metadata: Object.freeze({ 'file-id': record.id, sha256: actualSha }),
      });
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  const httpRouter = express.Router();
  httpRouter.put('/upload/:token', async (request, response, next) => {
    const intent = activeIntent(uploads, request.params.token);
    if (!intent) return response.status(404).json({ error: { code: 'upload_intent_not_found' } });
    const contentLength = Number(request.get('content-length'));
    const contentType = String(request.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (contentLength !== intent.record.byteSize || contentType !== intent.record.declaredMime) {
      return response.status(422).json({ error: { code: 'upload_constraints_failed' } });
    }
    const objectPath = safeObjectPath(root, intent.record.storageKey);
    const temporaryPath = `${objectPath}.upload-${request.params.token}`;
    let handle;
    try {
      await mkdir(path.dirname(objectPath), { recursive: true });
      handle = await open(temporaryPath, 'wx', 0o600);
      const digest = createHash('sha256');
      let received = 0;
      for await (const chunk of request) {
        received += chunk.length;
        if (received > intent.record.byteSize) throw new Error('upload_size_exceeded');
        digest.update(chunk);
        let offset = 0;
        while (offset < chunk.length) {
          const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset, null);
          if (bytesWritten < 1) throw new Error('local_upload_write_failed');
          offset += bytesWritten;
        }
      }
      await handle.sync();
      await handle.close();
      handle = null;
      if (received !== intent.record.byteSize || digest.digest('hex') !== intent.record.sha256) {
        throw new Error('upload_checksum_mismatch');
      }
      await rename(temporaryPath, objectPath);
      uploads.delete(request.params.token);
      response.status(204).end();
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      next(error);
    }
  });
  httpRouter.get('/download/:token', async (request, response, next) => {
    const intent = activeIntent(downloads, request.params.token);
    if (!intent) return response.status(404).json({ error: { code: 'download_intent_not_found' } });
    const objectPath = safeObjectPath(root, intent.record.storageKey);
    try {
      const metadata = await stat(objectPath);
      if (!metadata.isFile()) return response.status(404).end();
      response.setHeader('Content-Type', intent.record.detectedMime || intent.record.declaredMime);
      response.setHeader('Content-Length', String(metadata.size));
      response.setHeader('Content-Disposition', downloadDisposition(intent.record.originalName));
      fs.createReadStream(objectPath).on('error', next).pipe(response);
    } catch (error) {
      if (error.code === 'ENOENT') return response.status(404).end();
      next(error);
    }
  });

  return Object.freeze({
    basePrefix: config.prefix,
    bucket: config.bucket,
    httpRouter,
    provider: 'local',
    async close() {},
    async createDownloadUrl(record) {
      const rawToken = token();
      const expiresAt = new Date(Date.now() + config.downloadTtlSeconds * 1000);
      downloads.set(rawToken, { expiresAt, record });
      return Object.freeze({ expiresAt, method: 'GET', url: `/api/v1/file-objects/download/${rawToken}` });
    },
    async createUploadUrl(record) {
      const rawToken = token();
      const expiresAt = new Date(Date.now() + config.uploadTtlSeconds * 1000);
      uploads.set(rawToken, { expiresAt, record });
      return Object.freeze({
        expiresAt,
        method: 'PUT',
        requiredHeaders: Object.freeze({ 'content-type': record.declaredMime }),
        url: `/api/v1/file-objects/upload/${rawToken}`,
      });
    },
    async deleteObject(record) {
      await rm(safeObjectPath(root, record.storageKey), { force: true });
    },
    headObject,
    async listObjects({ maxObjects = 100_000 } = {}) {
      const objects = [];
      async function walk(directory) {
        const entries = await fs.promises.readdir(directory, { withFileTypes: true }).catch((error) => {
          if (error.code === 'ENOENT') return [];
          throw error;
        });
        for (const entry of entries) {
          const fullPath = path.join(directory, entry.name);
          if (entry.isDirectory()) await walk(fullPath);
          else if (entry.isFile()) {
            const metadata = await stat(fullPath);
            objects.push(Object.freeze({
              byteSize: metadata.size,
              etag: null,
              key: path.relative(root, fullPath).split(path.sep).join('/'),
              lastModified: metadata.mtime,
            }));
            if (objects.length > maxObjects) throw new Error('Object inventory limit exceeded.');
          }
        }
      }
      await walk(root);
      return Object.freeze(objects.sort((left, right) => left.key.localeCompare(right.key)));
    },
    async scanObject(record) {
      const bytes = await readFile(safeObjectPath(root, record.storageKey));
      const actualSha256 = sha256(bytes);
      let scanStatus = FILE_SCAN_STATUS.CLEAN;
      let mime = record.declaredMime;
      try {
        if (bytes.toString('latin1').includes(EICAR_MARKER)) {
          scanStatus = FILE_SCAN_STATUS.INFECTED;
        } else {
          mime = detectedMime(bytes, record.declaredMime);
        }
      } catch {
        scanStatus = FILE_SCAN_STATUS.UNSCANNABLE;
      }
      return Object.freeze({
        byteSize: bytes.length,
        detectedMime: mime,
        fileId: record.id,
        scanStatus,
        sha256: actualSha256,
      });
    },
  });
}

module.exports = { createLocalObjectStore, inspectZip, safeObjectPath };
