import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

/**
 * @typedef {object} RegressionScenarios
 * @property {Array<{ id: string, width: number }>} viewports
 * @property {Array<{ assertions: string[], fixture: string, path: string, viewportIds: string[] }>} routes
 * @property {Array<{ id: string }>} preferenceScenarios
 * @property {string[]} keyboardScenarios
 */

/** @param {URL} url */
const readJson = async (url) => JSON.parse(await readFile(url, 'utf8'));

test('regression matrix covers every route and required viewport exactly', async () => {
  /** @type {RegressionScenarios} */
  const scenarios = await readJson(
    new URL('../../client/tests/regression/p0e-s6.scenarios.json', import.meta.url),
  );

  assert.deepEqual(
    scenarios.viewports.map(({ width }) => width),
    [360, 390, 768, 1024, 1440],
  );
  assert.deepEqual(
    scenarios.routes.map(({ path }) => path),
    [
      '/',
      '/auth',
      '/dashboard',
      '/pathways',
      '/sandbox',
      '/profile',
      '/settings',
      '/challenges',
      '/challenges/new',
      '/challenges/:id',
      '/courses',
      '/space',
      '/company/dashboard',
      '/admin',
      '*',
    ],
  );
  assert.ok(
    scenarios.routes.every(
      ({ assertions, fixture, viewportIds }) => assertions.length && fixture && viewportIds.length,
    ),
  );
});

test('regression matrix preserves motion, contrast, keyboard, role, and protected-data fixtures', async () => {
  /** @type {RegressionScenarios} */
  const scenarios = await readJson(
    new URL('../../client/tests/regression/p0e-s6.scenarios.json', import.meta.url),
  );
  const fixtures = new Set(scenarios.routes.map(({ fixture }) => fixture));

  assert.deepEqual(
    scenarios.preferenceScenarios.map(({ id }) => id),
    ['reduced-motion', 'higher-contrast'],
  );
  assert.deepEqual(scenarios.keyboardScenarios, [
    'skip-to-main',
    'header-menu-open-close-focus-return',
    'dropdown-arrows-home-end-escape-tab',
    'dialog-tab-trap-escape-focus-return',
    'auth-mode-and-submit',
    'notes-open-edit-close',
  ]);
  for (const required of [
    'anonymous',
    'verified-learner',
    'verified-author',
    'published-challenge',
    'superadmin',
  ]) {
    assert.ok(fixtures.has(required));
  }
});

test('all route modules are lazy and have an accessible Suspense fallback', async () => {
  const app = await readFile(new URL('../../client/src/App.js', import.meta.url), 'utf8');

  assert.equal([...app.matchAll(/= lazy\(\(\) => import\(/g)].length, 14);
  assert.match(app, /<Suspense fallback=\{<RouteLoadingState \/>\}>/);
  assert.match(app, /label="Loading page"/);
  assert.match(app, /type="loading"/);
});

test('Vite emits a manifest and every client build enforces bounded route budgets', async () => {
  const [vite, clientPackage, budgets, checker] = await Promise.all([
    readFile(new URL('../../client/vite.config.mts', import.meta.url), 'utf8'),
    readJson(new URL('../../client/package.json', import.meta.url)),
    readJson(new URL('../../client/performance-budgets.json', import.meta.url)),
    readFile(new URL('../check-client-performance.mjs', import.meta.url), 'utf8'),
  ]);

  assert.match(vite, /manifest: true/);
  assert.equal(clientPackage.scripts.postbuild, 'node ../scripts/check-client-performance.mjs');
  assert.ok(budgets.initialJavaScriptGzipBytes <= 220 * 1024);
  assert.ok(budgets.homeRouteJavaScriptGzipBytes <= 240 * 1024);
  assert.ok(budgets.largestAssetBytes <= 512 * 1024);
  assert.ok(budgets.totalBuildBytes <= 2 * 1024 * 1024);
  for (const contract of [
    'collectGraph',
    'initialJavaScriptGzipBytes',
    'homeRouteJavaScriptGzipBytes',
    'authRouteJavaScriptGzipBytes',
    'largestAssetBytes',
    'totalBuildBytes',
  ]) {
    assert.match(checker, new RegExp(contract));
  }
});

test('browser baseline records observed public evidence without claiming protected or axe coverage', async () => {
  const baseline = await readFile(
    new URL('../../docs/baselines/P0E-S6_BROWSER_PERFORMANCE_BASELINE.md', import.meta.url),
    'utf8',
  );

  for (const width of [360, 390, 768, 1024, 1440]) {
    assert.match(baseline, new RegExp(`\\| ${width} x `));
  }
  assert.match(baseline, /Initial JavaScript, gzip\s+\|\s+168,464 B\s+\|\s+225,280 B/);
  assert.match(baseline, /found no external origin and no video asset/);
  assert.match(baseline, /No axe engine or screen reader was run/);
  assert.match(
    baseline,
    /Authenticated\/provider\/admin screenshots.*require deterministic non-production identities/,
  );
});
