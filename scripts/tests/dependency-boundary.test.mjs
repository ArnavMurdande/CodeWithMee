import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const repositoryRoot = new URL('../../', import.meta.url);

/** @param {string} relativePath */
async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, repositoryRoot), 'utf8'));
}

test('unused and abandoned direct dependencies stay removed', async () => {
  const [rootPackage, clientPackage, serverPackage] = await Promise.all([
    readJson('package.json'),
    readJson('client/package.json'),
    readJson('server/package.json'),
  ]);

  assert.equal(rootPackage.dependencies?.['@google/genai'], undefined);

  for (const dependency of [
    '@react-oauth/google',
    'framer-motion',
    'highcharts',
    'highcharts-react-official',
    'lucide-react',
    'prismjs',
    're-resizable',
    'react-player',
    'react-scripts',
    'react-youtube',
    'web-vitals',
  ]) {
    assert.equal(clientPackage.dependencies[dependency], undefined, dependency);
  }

  for (const dependency of ['babel-plugin-prismjs', 'customize-cra', 'react-app-rewired']) {
    assert.equal(clientPackage.devDependencies[dependency], undefined, dependency);
  }

  for (const dependency of [
    'google-auth-library',
    'groq-sdk',
    'mongodb',
    'mongoose',
    'piston-client',
    'python-shell',
    'react-player',
    'vm2',
  ]) {
    assert.equal(serverPackage.dependencies[dependency], undefined, dependency);
  }
});

test('reviewed security-sensitive direct versions stay pinned', async () => {
  const [rootPackage, clientPackage, serverPackage] = await Promise.all([
    readJson('package.json'),
    readJson('client/package.json'),
    readJson('server/package.json'),
  ]);

  assert.equal(rootPackage.devDependencies['@playwright/test'], '1.62.1');
  assert.equal(rootPackage.devDependencies['@axe-core/playwright'], '4.12.1');
  assert.equal(clientPackage.dependencies.axios, '1.19.0');
  assert.equal(clientPackage.dependencies['monaco-editor'], '0.56.0');
  assert.equal(clientPackage.overrides.dompurify, '3.4.12');
  assert.equal(serverPackage.dependencies.axios, '1.19.0');
  assert.equal(serverPackage.dependencies.argon2, '0.45.1');
  assert.equal(serverPackage.dependencies.jose, '6.2.6');
  assert.equal(serverPackage.dependencies.multer, '2.2.0');
  assert.equal(serverPackage.overrides['path-to-regexp'], '8.4.2');
  assert.equal(serverPackage.dependencies['@google/generative-ai'], '0.24.1');
  assert.equal(serverPackage.dependencies['@aws-sdk/client-s3'], '3.1093.0');
  assert.equal(serverPackage.dependencies['@aws-sdk/s3-request-presigner'], '3.1093.0');
});

test('removed dependency trees do not remain in lockfiles', async () => {
  const [rootLock, clientLock, serverLock] = await Promise.all([
    readFile(new URL('package-lock.json', repositoryRoot), 'utf8'),
    readFile(new URL('client/package-lock.json', repositoryRoot), 'utf8'),
    readFile(new URL('server/package-lock.json', repositoryRoot), 'utf8'),
  ]);

  assert.doesNotMatch(rootLock, /node_modules\/@google\/genai/);
  assert.doesNotMatch(clientLock, /node_modules\/(?:prismjs|react-scripts|react-app-rewired)/);
  assert.doesNotMatch(serverLock, /node_modules\/(?:vm2|python-shell|piston-client)/);
});
