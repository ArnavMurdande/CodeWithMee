import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** @param {string} relativePath */
async function read(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), 'utf8');
}

test('client tests use exact reviewed Vitest and jsdom versions', async () => {
  const manifest = JSON.parse(await read('client/package.json'));

  assert.equal(manifest.devDependencies.vitest, '4.1.10');
  assert.equal(manifest.devDependencies.jsdom, '30.0.1');
  assert.equal(manifest.scripts.test, 'vitest run --config vitest.config.mts');
  assert.equal(manifest.scripts['test:watch'], 'vitest --config vitest.config.mts');

  const config = await read('client/vitest.config.mts');
  assert.match(config, /environment: 'jsdom'/);
  assert.match(config, /url: 'https:\/\/codewithmee\.test\/'/);
  assert.match(config, /include: \['src\/\*\*\/\*\.test\.js'\]/);
  assert.match(config, /setupFiles: \['\.\/src\/test\/setup\.js'\]/);
});

test('client test setup is deterministic and denies unmocked network access', async () => {
  const [setup, factories] = await Promise.all([
    read('client/src/test/setup.js'),
    read('client/src/test/factories.js'),
  ]);

  assert.match(setup, /Object\.defineProperty\(window, 'matchMedia'/);
  assert.match(setup, /vi\.stubGlobal\(\s*'fetch'/);
  assert.match(setup, /Unmocked network access is forbidden/);
  assert.match(setup, /cleanup\(\)/);
  assert.match(factories, /createMatchMediaFactory/);
  assert.doesNotMatch(setup, /localhost|127\.0\.0\.1/);
});

test('real component suites exercise async, portal, keyboard, and focus behavior', async () => {
  const sources = await Promise.all(
    [
      'client/src/components/ui/AsyncState.test.js',
      'client/src/components/AppDropdown.test.js',
      'client/src/components/ui/AccessibleDialog.test.js',
    ].map(read),
  );
  const combined = sources.join('\n');

  assert.match(combined, /findBy|queryBy|waitFor|toBeInTheDocument/);
  assert.match(combined, /createPortal|document\.body|menu|listbox/);
  assert.match(combined, /keyboard\('/);
  assert.match(combined, /toHaveFocus\(\)/);
});

test('server factories and external fakes stay deterministic, local, and fail closed', async () => {
  const [factories, fakes, tests] = await Promise.all([
    read('server/test/support/factories.js'),
    read('server/test/support/external-fakes.js'),
    read('server/test/test-foundation.test.js'),
  ]);

  for (const factory of [
    'createTestClock',
    'createSequence',
    'createUserFactory',
    'createFileRecordFactory',
  ]) {
    assert.match(factories, new RegExp(`\\b${factory}\\b`));
  }
  for (const fake of [
    'createAiFake',
    'createVideoFake',
    'createEmailFake',
    'createStorageFake',
    'createRunnerFake',
  ]) {
    assert.match(fakes, new RegExp(`\\b${fake}\\b`));
    assert.match(tests, new RegExp(`\\b${fake}\\b`));
  }

  assert.match(fakes, /fake has no scripted result/);
  assert.match(fakes, /https:\/\/storage\.invalid\//);
  assert.doesNotMatch(
    fakes,
    /(?:require\(|from\s+)['"](?:axios|node:https?|nodemailer|openai|youtube)/i,
  );
});
