import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createRuntimeConfig, resolveBackendUrl } from '../../client/src/config/runtime.ts';

const clientSourceRoot = fileURLToPath(new URL('../../client/src/', import.meta.url));

/**
 * @param {string} directory
 * @returns {Promise<string[]>}
 */
async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nestedFiles = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      return entry.isDirectory() ? sourceFiles(entryPath) : [entryPath];
    }),
  );

  return nestedFiles.flat();
}

test('runtime config defaults to same-origin API requests', () => {
  const config = createRuntimeConfig({});

  assert.equal(config.apiBaseUrl, '');
  assert.equal(config.apiTimeoutMs, 20_000);
});

test('runtime config normalizes a configured HTTPS API origin', () => {
  const config = createRuntimeConfig({
    apiBaseUrl: 'https://api.codewithmee.example/',
    apiTimeoutMs: '15000',
  });

  assert.deepEqual(config, {
    apiBaseUrl: 'https://api.codewithmee.example',
    apiTimeoutMs: 15_000,
  });
});

test('runtime config rejects unsafe or ambiguous API base URLs', () => {
  assert.throws(() => createRuntimeConfig({ apiBaseUrl: 'javascript:alert(1)' }), /HTTP/);
  assert.throws(
    () => createRuntimeConfig({ apiBaseUrl: 'https://user:pass@example.com' }),
    /without credentials/,
  );
  assert.throws(
    () => createRuntimeConfig({ apiBaseUrl: 'https://example.com/backend' }),
    /without credentials/,
  );
  assert.throws(() => createRuntimeConfig({ apiTimeoutMs: '500' }), /between 1000 and 120000/);
});

test('backend asset URLs support same-origin, configured-origin, and external values', () => {
  assert.equal(resolveBackendUrl('/uploads/avatar.png', ''), '/uploads/avatar.png');
  assert.equal(
    resolveBackendUrl('/uploads/avatar.png', 'https://api.codewithmee.example'),
    'https://api.codewithmee.example/uploads/avatar.png',
  );
  assert.equal(
    resolveBackendUrl('https://cdn.example/avatar.png', 'https://api.codewithmee.example'),
    'https://cdn.example/avatar.png',
  );
  assert.equal(resolveBackendUrl(undefined, 'https://api.codewithmee.example'), '');
});

test('client source has one direct Axios boundary and no hard-coded development origin', async () => {
  const files = (await sourceFiles(clientSourceRoot)).filter((file) =>
    /\.[cm]?[jt]sx?$/.test(file),
  );
  const directAxiosImports = [];

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(source, /http:\/\/localhost:5001/, path.relative(clientSourceRoot, file));

    if (/from ['"]axios['"]/.test(source)) {
      directAxiosImports.push(path.relative(clientSourceRoot, file).replaceAll('\\', '/'));
    }
  }

  assert.deepEqual(directAxiosImports, ['lib/api.ts']);
});
