import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  clearAccessToken,
  getAccessToken,
  setAccessToken,
  subscribeToAccessToken,
} from '../../client/src/lib/auth-session.ts';

const clientSourceRoot = fileURLToPath(new URL('../../client/src/', import.meta.url));

/**
 * @param {string} directory
 * @returns {Promise<string[]>}
 */
async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      return entry.isDirectory() ? sourceFiles(entryPath) : [entryPath];
    }),
  );
  return nested.flat().filter((file) => /\.[cm]?[jt]sx?$/.test(file));
}

test('access tokens stay in module memory and notify subscribers', () => {
  /** @type {(string | null)[]} */
  const values = [];
  const unsubscribe = subscribeToAccessToken((value) => values.push(value));

  clearAccessToken();
  setAccessToken('short-lived-access-token');
  assert.equal(getAccessToken(), 'short-lived-access-token');
  clearAccessToken();
  unsubscribe();
  setAccessToken('ignored-after-unsubscribe');

  assert.deepEqual(values, ['short-lived-access-token', null]);
  clearAccessToken();
});

test('client source has no persistent or legacy authentication transport', async () => {
  for (const file of await sourceFiles(clientSourceRoot)) {
    const source = await readFile(file, 'utf8');
    const relativePath = path.relative(clientSourceRoot, file);
    assert.doesNotMatch(source, /x-auth-token/i, relativePath);
    assert.doesNotMatch(source, /\/api\/auth(?:[/'"`?]|$)/, relativePath);
    assert.doesNotMatch(
      source,
      /localStorage\.(?:getItem|setItem|removeItem)\(\s*['"](?:token|authToken|accessToken)['"]/i,
      relativePath,
    );
  }
});

test('shared API client owns Bearer, CSRF, credential, and refresh behavior', async () => {
  const source = await readFile(new URL('../../client/src/lib/api.ts', import.meta.url), 'utf8');

  assert.match(source, /withCredentials:\s*true/);
  assert.match(source, /Authorization/);
  assert.match(source, /Bearer \$\{accessToken\}/);
  assert.match(source, /cwm_csrf/);
  assert.match(source, /x-csrf-token/);
  assert.match(source, /refreshPromise/);
  assert.match(source, /\/api\/v1\/auth\/refresh/);
});

test('web identity UX covers verification, recovery, and session revocation', async () => {
  const [authContext, authPage, securityPanel, clientPackage, runtimeConfig, environmentExample] =
    await Promise.all([
      readFile(new URL('../../client/src/context/AuthContext.js', import.meta.url), 'utf8'),
      readFile(new URL('../../client/src/pages/Auth.js', import.meta.url), 'utf8'),
      readFile(
        new URL('../../client/src/components/SessionSecurityPanel.js', import.meta.url),
        'utf8',
      ),
      readFile(new URL('../../client/package.json', import.meta.url), 'utf8'),
      readFile(new URL('../../client/src/config/runtime.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../client/.env.example', import.meta.url), 'utf8'),
    ]);

  assert.match(authContext, /refreshAuthentication/);
  assert.match(authContext, /\/api\/v1\/auth\/email\/verify/);
  assert.match(authContext, /\/api\/v1\/auth\/password/);
  assert.match(authContext, /\/api\/v1\/me\/sessions/);
  assert.match(authPage, /Continue with Google/);
  assert.match(authPage, /Forgot password/);
  assert.match(securityPanel, /Active sessions/);
  assert.doesNotMatch(clientPackage, /@react-oauth\/google/);
  assert.doesNotMatch(runtimeConfig, /googleClientId|VITE_GOOGLE_CLIENT_ID/);
  assert.doesNotMatch(environmentExample, /VITE_GOOGLE_CLIENT_ID/);
});

test('client storage keys use user isolation helpers for authenticated data', async () => {
  for (const file of await sourceFiles(clientSourceRoot)) {
    const source = await readFile(file, 'utf8');
    const relativePath = path.relative(clientSourceRoot, file);
    if (relativePath.includes('cache-isolation')) continue;

    assert.doesNotMatch(
      source,
      /localStorage\.(?:getItem|setItem)\(\s*['"]cwm_saved_roadmaps['"]\s*[,)]/,
      `Unscoped cwm_saved_roadmaps found in ${relativePath}`,
    );
    assert.doesNotMatch(
      source,
      /localStorage\.(?:getItem|setItem)\(\s*['"]cwm_saved_notes['"]\s*[,)]/,
      `Unscoped cwm_saved_notes found in ${relativePath}`,
    );
    assert.doesNotMatch(
      source,
      /localStorage\.(?:getItem|setItem)\(\s*[`'"]cwm_vid_progress_/,
      `Unscoped cwm_vid_progress found in ${relativePath}`,
    );
  }
});
