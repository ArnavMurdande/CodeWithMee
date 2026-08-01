import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const clientRoot = path.join(repositoryRoot, 'client');
const distRoot = path.join(clientRoot, 'dist');
const manifestPath = path.join(distRoot, '.vite', 'manifest.json');
/** @type {Record<string, number>} */
const budgets = JSON.parse(
  await readFile(path.join(clientRoot, 'performance-budgets.json'), 'utf8'),
);
/** @typedef {{ css?: string[], file: string, imports?: string[], isEntry?: boolean }} ManifestEntry */
/** @type {Record<string, ManifestEntry>} */
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

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

/** @param {string} suffix */
function manifestKey(suffix) {
  const key = Object.keys(manifest).find((candidate) => candidate.endsWith(suffix));
  if (!key) throw new Error(`Vite manifest is missing ${suffix}.`);
  return key;
}

/** @param {string[]} startKeys */
function collectGraph(startKeys) {
  /** @type {Set<string>} */
  const keys = new Set();
  /** @param {string} key */
  function visit(key) {
    if (keys.has(key)) return;
    const chunk = manifest[key];
    if (!chunk) throw new Error(`Vite manifest references unknown chunk ${key}.`);
    keys.add(key);
    for (const dependency of chunk.imports || []) visit(dependency);
  }
  for (const key of startKeys) visit(key);
  return keys;
}

/** @param {Iterable<string>} keys */
async function graphMetrics(keys) {
  /** @type {Set<string>} */
  const files = new Set();
  for (const key of keys) {
    const chunk = manifest[key];
    files.add(chunk.file);
    for (const css of chunk.css || []) files.add(css);
  }

  let javaScriptGzipBytes = 0;
  let cssGzipBytes = 0;
  for (const file of files) {
    const bytes = await readFile(path.join(distRoot, file));
    const gzipBytes = gzipSync(bytes).byteLength;
    if (file.endsWith('.js')) javaScriptGzipBytes += gzipBytes;
    if (file.endsWith('.css')) cssGzipBytes += gzipBytes;
  }
  return {
    cssGzipBytes,
    files: [...files].sort(),
    javaScriptGzipBytes,
    requestCount: files.size,
  };
}

const entryKey = Object.keys(manifest).find((key) => manifest[key].isEntry);
if (!entryKey) throw new Error('Vite manifest has no application entry.');

const entryGraph = collectGraph([entryKey]);
const homeGraph = collectGraph([entryKey, manifestKey('src/pages/HomePage.js')]);
const authGraph = collectGraph([entryKey, manifestKey('src/pages/Auth.js')]);
const [initial, home, auth] = await Promise.all([
  graphMetrics(entryGraph),
  graphMetrics(homeGraph),
  graphMetrics(authGraph),
]);

const buildFiles = (await walk(distRoot)).filter((file) => file !== manifestPath);
const buildSizes = await Promise.all(
  buildFiles.map(async (file) => ({
    bytes: (await stat(file)).size,
    file: path.relative(distRoot, file).replaceAll('\\', '/'),
  })),
);
const totalBuildBytes = buildSizes.reduce((total, file) => total + file.bytes, 0);
const largestAsset = buildSizes.toSorted((left, right) => right.bytes - left.bytes)[0];

const measurements = {
  authRouteJavaScriptGzipBytes: auth.javaScriptGzipBytes,
  homeRouteJavaScriptGzipBytes: home.javaScriptGzipBytes,
  initialCssGzipBytes: initial.cssGzipBytes,
  initialJavaScriptGzipBytes: initial.javaScriptGzipBytes,
  initialRequestCount: initial.requestCount,
  largestAssetBytes: largestAsset?.bytes || 0,
  largestAssetFile: largestAsset?.file || null,
  totalBuildBytes,
};

/** @typedef {'initialJavaScriptGzipBytes' | 'initialCssGzipBytes' | 'initialRequestCount' | 'homeRouteJavaScriptGzipBytes' | 'authRouteJavaScriptGzipBytes' | 'largestAssetBytes' | 'totalBuildBytes'} BudgetKey */
/** @type {BudgetKey[]} */
const budgetKeys = [
  'initialJavaScriptGzipBytes',
  'initialCssGzipBytes',
  'initialRequestCount',
  'homeRouteJavaScriptGzipBytes',
  'authRouteJavaScriptGzipBytes',
  'largestAssetBytes',
  'totalBuildBytes',
];
const failures = [];
for (const key of budgetKeys) {
  if (measurements[key] > budgets[key]) {
    failures.push(`${key}: ${measurements[key]} > ${budgets[key]}`);
  }
}

console.log(JSON.stringify({ budgets, measurements }, null, 2));
if (failures.length) {
  throw new Error(`Client performance budget exceeded:\n${failures.join('\n')}`);
}
