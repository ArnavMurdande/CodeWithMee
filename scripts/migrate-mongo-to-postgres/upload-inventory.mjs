import { createHash, createHmac } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

/**
 * @param {Buffer} header
 * @param {string} extension
 */
function detectMime(header, extension) {
  const hex = header.toString('hex');
  if (hex.startsWith('89504e470d0a1a0a')) return 'image/png';
  if (hex.startsWith('ffd8ff')) return 'image/jpeg';
  if (hex.startsWith('47494638')) return 'image/gif';
  if (header.subarray(0, 4).toString('ascii') === 'PK\u0003\u0004') return 'application/zip';
  if (header.subarray(4, 8).toString('ascii') === 'ftyp') return 'video/mp4';
  if (hex.startsWith('25504446')) return 'application/pdf';
  if (extension === '.txt') return 'text/plain';
  if (extension === '.md') return 'text/markdown';
  return 'application/octet-stream';
}

/** @param {string} filePath */
async function hashAndInspect(filePath) {
  const hash = createHash('sha256');
  const headerChunks = [];
  let headerBytes = 0;
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
    if (headerBytes < 32) {
      const needed = Math.min(32 - headerBytes, chunk.length);
      headerChunks.push(chunk.subarray(0, needed));
      headerBytes += needed;
    }
  }
  return { header: Buffer.concat(headerChunks), sha256: hash.digest('hex') };
}

/**
 * @param {string} directory
 * @returns {Promise<string[]>}
 */
async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  /** @type {string[]} */
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(child)));
    else files.push(child);
  }
  return files;
}

/**
 * @param {Buffer} key
 * @param {string} value
 */
function hmac(key, value) {
  return createHmac('sha256', key).update(value).digest('hex');
}

/**
 * @param {{ fingerprintKey: Buffer, uploadRoot?: string }} options
 */
export async function inventoryUploads({ fingerprintKey, uploadRoot }) {
  if (!uploadRoot)
    return { available: false, duplicates: [], exceptions: [], files: [], totals: {} };
  const root = await realpath(path.resolve(uploadRoot));
  /** @type {Array<import('./types.mjs').LegacyDocument>} */
  const records = [];
  /** @type {Array<import('./types.mjs').LegacyDocument>} */
  const exceptions = [];

  for (const filePath of await collectFiles(root)) {
    const sourceMetadata = await lstat(filePath);
    if (sourceMetadata.isSymbolicLink()) {
      exceptions.push({
        code: 'unsupported_upload_symlink',
        pathFingerprint: hmac(fingerprintKey, path.relative(root, filePath)),
        severity: 'error',
      });
      continue;
    }
    const resolved = await realpath(filePath);
    const relative = path.relative(root, resolved).split(path.sep).join('/');
    if (relative.startsWith('../') || path.isAbsolute(relative)) {
      throw new Error('Upload inventory path escaped its root');
    }
    const metadata = await lstat(resolved);
    if (!metadata.isFile()) {
      exceptions.push({
        code: 'unsupported_upload_entry',
        pathFingerprint: hmac(fingerprintKey, relative),
        severity: 'error',
      });
      continue;
    }

    const inspected = await hashAndInspect(resolved);
    const extension = path.extname(relative).toLowerCase();
    const ownerMatch = path.basename(relative).match(/(?:^|[-_])user-([a-z0-9]+)(?:[-_.]|$)/i);
    records.push({
      bytes: metadata.size,
      detectedMime: detectMime(inspected.header, extension),
      extension: extension || null,
      modifiedAt: metadata.mtime.toISOString(),
      ownerHintFingerprint: ownerMatch ? hmac(fingerprintKey, ownerMatch[1]) : null,
      pathFingerprint: hmac(fingerprintKey, relative),
      sha256: inspected.sha256,
      topLevelArea: relative.includes('/') ? relative.split('/')[0] : 'root',
    });
  }

  records.sort((left, right) => left.pathFingerprint.localeCompare(right.pathFingerprint));
  /** @type {Map<string, string[]>} */
  const byHash = new Map();
  for (const record of records) {
    const entries = byHash.get(record.sha256) || [];
    entries.push(record.pathFingerprint);
    byHash.set(record.sha256, entries);
  }
  const duplicates = [...byHash.entries()]
    .filter(([, paths]) => paths.length > 1)
    .map(([sha, paths]) => ({ count: paths.length, pathFingerprints: paths.sort(), sha256: sha }))
    .sort((left, right) => left.sha256.localeCompare(right.sha256));

  return {
    available: true,
    duplicates,
    exceptions,
    files: records,
    rootFingerprint: hmac(fingerprintKey, root.toLowerCase()),
    totals: {
      bytes: records.reduce((total, record) => total + record.bytes, 0),
      files: records.length,
      uniqueContent: byHash.size,
    },
  };
}
