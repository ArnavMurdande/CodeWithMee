import assert from 'node:assert/strict';
import { access, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const clientRoot = fileURLToPath(new URL('../../client/src/', import.meta.url));
const extensions = ['.js', '.tsx', '.ts', '.css', '.svg', '.mp4'];
const inventoryUrl = new URL(
  '../../docs/baselines/P0E-S4_PRODUCT_SURFACE_INVENTORY.md',
  import.meta.url,
);

/** @param {string} directory @returns {Promise<string[]>} */
async function walk(directory) {
  /** @type {string[]} */
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(target)));
    else files.push(target);
  }
  return files;
}

/** @param {string} fromFile @param {string} specifier */
async function resolveRelativeImport(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    base,
    ...extensions.map((extension) => `${base}${extension}`),
    ...extensions.map((extension) => path.join(base, `index${extension}`)),
  ];
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
    }
  }
  return null;
}

/** @param {string} entrypoint */
async function reachableClientFiles(entrypoint) {
  /** @type {Set<string>} */
  const reachable = new Set();
  /** @param {string} file */
  async function visit(file) {
    if (reachable.has(file)) return;
    reachable.add(file);
    if (!/\.(?:css|js|ts|tsx)$/.test(file)) return;

    const source = await readFile(file, 'utf8');
    /** @type {string[]} */
    const specifiers = [];
    for (const expression of [
      /\b(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g,
      /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
      /@import\s+['"]([^'"]+)['"]/g,
    ]) {
      for (const match of source.matchAll(expression)) specifiers.push(match[1]);
    }
    for (const specifier of specifiers) {
      const dependency = await resolveRelativeImport(file, specifier);
      if (dependency) await visit(dependency);
    }
  }

  await visit(entrypoint);
  return reachable;
}

test('every shipped client source or asset is reachable from the Vite entrypoint', async () => {
  const [files, reachable] = await Promise.all([
    walk(clientRoot),
    reachableClientFiles(path.join(clientRoot, 'main.tsx')),
  ]);
  const unreachable = files
    .filter(
      (file) =>
        !file.endsWith('.d.ts') &&
        !file.includes(`${path.sep}test${path.sep}`) &&
        !/\.test\.[^.]+$/.test(file) &&
        !reachable.has(file),
    )
    .map((file) => path.relative(clientRoot, file))
    .sort();

  assert.deepEqual(unreachable, []);
});

test('client route inventory is exact and retired provider bookmarks fail closed', async () => {
  const app = await readFile(path.join(clientRoot, 'App.js'), 'utf8');
  const paths = [...app.matchAll(/\bpath="([^"]+)"/g)].map((match) => match[1]);

  assert.deepEqual(paths, [
    '/',
    '/auth',
    '/dashboard',
    '/pathways',
    '/sandbox',
    '/profile',
    '/settings',
    '/provider',
    '/challenges',
    '/challenges/new',
    '/challenges/:id',
    '/courses',
    '/space',
    '/company/dashboard',
    '/admin',
    '*',
  ]);
  assert.match(
    app,
    /<Route element=\{<Navigate replace to="\/dashboard" \/>\} path="\/company\/dashboard" \/>/,
  );
  assert.doesNotMatch(app, /CompanyDashboard/);
});

test('visible placeholders and links to nonexistent product routes stay removed', async () => {
  const files = (await walk(clientRoot)).filter((file) => /\.(?:js|tsx)$/.test(file));
  const source = (await Promise.all(files.map((file) => readFile(file, 'utf8')))).join('\n');

  assert.doesNotMatch(source, /Coming Soon|available in the next update|placehold\.co/i);
  assert.doesNotMatch(source, /(?:to="|navigate\(['"])\/(?:notes|simulations)\b/);
  assert.doesNotMatch(source, /Share feature coming soon/);

  for (const removed of [
    'App.css',
    'components/MobileWarningOverlay.js',
    'components/MobileWarningOverlay.css',
    'pages/company/CompanyDashboard.js',
    'pages/company/CompanyDashboard.css',
  ]) {
    await assert.rejects(access(path.join(clientRoot, removed)), { code: 'ENOENT' });
  }
});

test('retained legacy endpoint families have explicit states, replacements, and final owners', async () => {
  const lifecycle = await readFile(
    new URL('../../server/modules/api/legacy-route-lifecycle.js', import.meta.url),
    'utf8',
  );
  const mounts = [...lifecycle.matchAll(/mount: '([^']+)'/g)].map((match) => match[1]);
  const owners = [...lifecycle.matchAll(/finalOwner: '([^']+)'/g)].map((match) => match[1]);
  const replacements = [...lifecycle.matchAll(/replacement: '([^']+)'/g)].map((match) => match[1]);

  assert.deepEqual(mounts, [
    '/api/auth',
    '/api/code',
    '/api/ai',
    '/api/youtube',
    '/api/roadmap',
    '/api/user',
    '/api/challenges',
    '/api/courses',
    '/api/admin',
    '/api/space',
  ]);
  assert.deepEqual(owners, [
    'P0D-S6',
    'P1B',
    'P1B',
    'P1C',
    'P1C',
    'P1C',
    'P1B',
    'P1C',
    'P0B-S6',
    'P4C',
  ]);
  assert.equal(replacements.length, mounts.length);
  assert.equal((lifecycle.match(/state: LEGACY_ROUTE_STATE\.TOMBSTONE/g) || []).length, 2);
  assert.equal((lifecycle.match(/state: LEGACY_ROUTE_STATE\.COMPATIBILITY/g) || []).length, 8);
});

test('the product inventory covers every component, route, v1 operation, and legacy verb', async () => {
  const [inventory, app, openApi] = await Promise.all([
    readFile(inventoryUrl, 'utf8'),
    readFile(path.join(clientRoot, 'App.js'), 'utf8'),
    readFile(
      new URL('../../docs/openapi/codewithmee-v1.openapi.json', import.meta.url),
      'utf8',
    ).then(JSON.parse),
  ]);
  const normalizedInventory = inventory
    .split('\n')
    .map((line) =>
      line
        .split('|')
        .map((cell) => cell.trim())
        .join('|'),
    )
    .join('\n');

  const componentFiles = (await walk(path.join(clientRoot, 'components'))).filter(
    (file) => /\.(?:js|tsx)$/.test(file) && !/\.test\.(?:js|tsx)$/.test(file),
  );
  for (const file of componentFiles) {
    assert.match(
      inventory,
      new RegExp(`\\b${path.basename(file).replace(/\.(?:js|tsx)$/, '')}\\b`),
    );
  }

  for (const match of app.matchAll(/\bpath="([^"]+)"/g)) {
    assert.ok(inventory.includes(`\`${match[1]}\``), `route missing from inventory: ${match[1]}`);
  }

  for (const [routePath, pathItem] of Object.entries(openApi.paths)) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      const operation = pathItem[method];
      if (!operation) continue;
      const row = `|\`${method.toUpperCase()}\`|\`${routePath}\`|\`${operation.operationId}\`|`;
      assert.ok(
        normalizedInventory.includes(row),
        `v1 operation missing from inventory: ${operation.operationId}`,
      );
    }
  }

  const legacyRoutesDirectory = fileURLToPath(new URL('../../server/routes/', import.meta.url));
  for (const file of (await readdir(legacyRoutesDirectory)).filter((name) =>
    name.endsWith('.js'),
  )) {
    const source = await readFile(path.join(legacyRoutesDirectory, file), 'utf8');
    for (const match of source.matchAll(
      /router\.(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]/g,
    )) {
      const row = `|\`${file}\`|\`${match[1].toUpperCase()}\`|\`${match[2]}\`|`;
      assert.ok(
        normalizedInventory.includes(row),
        `legacy endpoint missing from inventory: ${row}`,
      );
    }
  }
  assert.match(inventory, /`\/api\/auth\/\*` is one catch-all `410` tombstone/);
});
