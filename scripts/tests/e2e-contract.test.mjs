import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const repositoryRoot = new URL('../../', import.meta.url);

/** @param {string} relativePath */
const read = (relativePath) => readFile(new URL(relativePath, repositoryRoot), 'utf8');

test('Playwright is exact, Chromium-only, bounded, and retains artifacts only on failure', async () => {
  const [manifest, config] = await Promise.all([
    read('package.json').then(JSON.parse),
    read('playwright.config.mts'),
  ]);

  assert.equal(manifest.devDependencies['@playwright/test'], '1.62.1');
  assert.equal(manifest.devDependencies['@axe-core/playwright'], '4.12.1');
  assert.equal(manifest.scripts['test:e2e'], 'npm run build:client && playwright test');
  assert.match(config, /name: 'chromium'/);
  assert.match(config, /retries: 0/);
  assert.match(config, /screenshot: 'only-on-failure'/);
  assert.match(config, /trace: 'retain-on-failure'/);
  assert.match(config, /video: 'off'/);
  assert.match(config, /serviceWorkers: 'block'/);
  assert.match(config, /reuseExistingServer: false/);
});

test('browser fixtures deny unexpected APIs and external origins', async () => {
  const suite = await read('e2e/p0f-smoke.spec.mjs');

  assert.match(suite, /const baseOrigin = 'http:\/\/127\.0\.0\.1:4173'/);
  assert.match(suite, /unexpectedApi\.push/);
  assert.match(suite, /unexpectedOrigins\.push/);
  assert.match(suite, /unconfigured_e2e_request/);
  assert.match(suite, /route\.abort\('blockedbyclient'\)/);
  assert.match(suite, /example\.invalid/);
  assert.doesNotMatch(suite, /@(?:gmail|outlook|yahoo)\./);
});

test('the five required protected smoke flows and role denial are explicit', async () => {
  const suite = await read('e2e/p0f-smoke.spec.mjs');
  assert.equal((suite.match(/^test\('/gm) || []).length, 5);
  for (const contract of [
    'POST /api/v1/auth/login',
    'Mobile primary navigation',
    'PUT /api/user/me',
    'GET /api/challenges/challenge-two-sum',
    'GET /api/v1/admin/provider-verifications',
    "platformRole: 'superadmin'",
    "learnerPage.goto('/admin')",
  ]) {
    assert.match(suite, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('axe blocks serious/critical findings and health checks cover runtime failures and overflow', async () => {
  const suite = await read('e2e/p0f-smoke.spec.mjs');
  assert.match(suite, /new AxeBuilder\(\{ page \}\)/);
  assert.match(suite, /'wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'/);
  assert.match(suite, /\['critical', 'serious'\]/);
  assert.match(suite, /pageErrors/);
  assert.match(suite, /scrollWidth[\s\S]*clientWidth/);
  assert.match(suite, /page\.locator\('main'\)/);
});

test('remote avatar fallback is removed and Monaco compatibility assets are version-pinned', async () => {
  const [clientSource, editor, suite, clientManifest] = await Promise.all([
    Promise.all(
      [
        'client/src/components/Header.js',
        'client/src/pages/Profile.js',
        'client/src/pages/Space.js',
      ].map(read),
    ).then((values) => values.join('\n')),
    read('client/src/components/CodeEditor.js'),
    read('e2e/p0f-smoke.spec.mjs'),
    read('client/package.json').then(JSON.parse),
  ]);

  assert.doesNotMatch(clientSource, /i\.imgur\.com/);
  assert.match(clientSource, /default-avatar\.svg/);
  assert.equal(clientManifest.dependencies['monaco-editor'], '0.56.0');
  assert.equal(clientManifest.overrides.dompurify, '3.4.12');
  assert.match(editor, /monaco-editor@0\.56\.0\/min\/vs/);
  assert.match(suite, /monaco-editor@0\.56\.0\/min\/vs/);
  assert.match(suite, /client\/node_modules\/monaco-editor\/min\/vs/);
});
