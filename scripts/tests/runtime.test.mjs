import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  parseMajor,
  SUPPORTED_NODE_MAJOR,
  SUPPORTED_NPM_MAJOR,
  validateRuntime,
} from '../lib/runtime.mjs';

const repositoryRoot = new URL('../../', import.meta.url);

test('parseMajor accepts Node and npm version formats', () => {
  assert.equal(parseMajor('v24.18.0'), 24);
  assert.equal(parseMajor('11.5.2'), 11);
  assert.equal(parseMajor('not-a-version'), null);
});

test('validateRuntime accepts the pinned Node and npm majors', () => {
  assert.deepEqual(
    validateRuntime({
      nodeVersion: `v${SUPPORTED_NODE_MAJOR}.18.0`,
      npmUserAgent: `npm/${SUPPORTED_NPM_MAJOR}.5.2 node/v24.18.0 win32 x64`,
    }),
    { errors: [], warnings: [] },
  );
});

test('validateRuntime rejects unsupported major versions', () => {
  const result = validateRuntime({
    nodeVersion: 'v25.1.0',
    npmUserAgent: 'npm/12.0.0 node/v25.1.0 win32 x64',
  });

  assert.equal(result.errors.length, 2);
});

test('root command contract is private, pinned, and complete', async () => {
  const packageJson = JSON.parse(
    await readFile(new URL('package.json', repositoryRoot), { encoding: 'utf8' }),
  );
  const requiredScripts = [
    'preflight',
    'install:all',
    'build',
    'lint',
    'typecheck',
    'test',
    'format',
    'format:check',
    'check:tooling',
    'check',
  ];

  assert.equal(packageJson.private, true);
  assert.equal(packageJson.packageManager, 'npm@11.5.2');
  assert.equal(packageJson.engines.node, '>=24.0.0 <25');
  assert.equal(packageJson.engines.npm, '>=11.0.0 <12');

  for (const script of requiredScripts) {
    assert.equal(typeof packageJson.scripts[script], 'string', `missing script: ${script}`);
  }
});

test('runtime pin files agree with the preflight contract', async () => {
  const nvmVersion = (await readFile(new URL('.nvmrc', repositoryRoot), 'utf8')).trim();
  const nodeVersion = (await readFile(new URL('.node-version', repositoryRoot), 'utf8')).trim();

  assert.equal(nvmVersion, nodeVersion);
  assert.equal(parseMajor(nvmVersion), SUPPORTED_NODE_MAJOR);
});

test('Vite is the sole client build path after verified CRA retirement', async () => {
  const clientPackage = JSON.parse(
    await readFile(new URL('client/package.json', repositoryRoot), { encoding: 'utf8' }),
  );
  const viteHtml = await readFile(new URL('client/index.html', repositoryRoot), 'utf8');

  assert.equal(clientPackage.scripts.start, 'vite');
  assert.equal(clientPackage.scripts.build, 'vite build');
  assert.equal(clientPackage.type, 'module');
  assert.equal(clientPackage.scripts['legacy:build'], undefined);
  assert.equal(clientPackage.dependencies['react-scripts'], undefined);
  assert.equal(clientPackage.devDependencies['react-app-rewired'], undefined);
  assert.equal(clientPackage.devDependencies['customize-cra'], undefined);
  assert.equal(clientPackage.devDependencies['babel-plugin-prismjs'], undefined);
  assert.equal(clientPackage.devDependencies.vite, '8.2.0');
  assert.equal(clientPackage.devDependencies['@vitejs/plugin-react'], '5.2.0');
  assert.match(viteHtml, /src="\/src\/main\.tsx"/);
  await assert.rejects(access(new URL('client/public/index.html', repositoryRoot)), {
    code: 'ENOENT',
  });
});
