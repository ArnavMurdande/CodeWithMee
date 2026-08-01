import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { evaluateAuditReport } from '../ci/check-audit.mjs';
import { evaluateContainerFiles } from '../ci/check-containers.mjs';
import { evaluateLicenseLock } from '../ci/check-licenses.mjs';
import { checkOpenApiArtifact } from '../ci/check-openapi.mjs';
import { evaluatePhaseZeroTracker } from '../ci/check-phase0-release.mjs';
import { findPotentialSecrets } from '../ci/check-secrets.mjs';
import { evaluateWorkflowText } from '../ci/check-workflows.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '../..');
const require = createRequire(import.meta.url);
const policy = JSON.parse(
  readFileSync(path.join(repositoryRoot, 'scripts/ci/security-policy.json'), 'utf8'),
);
const policyDate = new Date('2026-08-01T00:00:00.000Z');

/** @returns {any} */
function routerAuditReport() {
  return {
    auditReportVersion: 2,
    vulnerabilities: {
      'react-router': {
        name: 'react-router',
        severity: 'high',
        via: [
          {
            source: 1124282,
            url: 'https://github.com/advisories/GHSA-qwww-vcr4-c8h2',
          },
        ],
      },
      'react-router-dom': {
        name: 'react-router-dom',
        severity: 'high',
        via: ['react-router'],
      },
    },
  };
}

test('OpenAPI gate matches the committed artifact and reports the executable surface', () => {
  const modulePath = path.join(repositoryRoot, 'server/modules/api/openapi.js');
  const { openApiDocument } = require(modulePath);
  const result = checkOpenApiArtifact({
    actualDocument: openApiDocument,
    artifactText: readFileSync(
      path.join(repositoryRoot, 'docs/openapi/codewithmee-v1.openapi.json'),
      'utf8',
    ),
  });
  assert.equal(result.paths, 37);
  assert.equal(result.operations, 41);
});

test('OpenAPI gate rejects generated-contract drift', () => {
  assert.throws(
    () => checkOpenApiArtifact({ actualDocument: { openapi: '3.1.1' }, artifactText: '{}\n' }),
    /artifact drifted/,
  );
});

test('audit gate accepts only the exact reviewed transitive advisory graph', () => {
  assert.deepEqual(
    evaluateAuditReport({
      workspace: 'client',
      report: routerAuditReport(),
      policy,
      now: policyDate,
    }),
    { exceptions: 1, vulnerabilities: 2 },
  );
});

test('audit gate rejects unknown findings and expired exceptions', () => {
  const unknown = routerAuditReport();
  unknown.vulnerabilities.axios = {
    name: 'axios',
    severity: 'critical',
    via: [{ source: 999, url: 'https://github.com/advisories/GHSA-unknown' }],
  };
  assert.throws(
    () => evaluateAuditReport({ workspace: 'client', report: unknown, policy, now: policyDate }),
    /unapproved npm audit findings/,
  );
  assert.throws(
    () =>
      evaluateAuditReport({
        workspace: 'client',
        report: routerAuditReport(),
        policy,
        now: new Date('2026-10-01T00:00:00.000Z'),
      }),
    /expired/,
  );
});

test('license gate accepts the current exact lock inventories', () => {
  for (const [workspace, lockPath] of [
    ['root', 'package-lock.json'],
    ['client', 'client/package-lock.json'],
    ['server', 'server/package-lock.json'],
  ]) {
    const result = evaluateLicenseLock({
      workspace,
      lock: JSON.parse(readFileSync(path.join(repositoryRoot, lockPath), 'utf8')),
      policy,
      now: policyDate,
    });
    assert.ok(result.packages > 0);
  }
});

test('license gate rejects strong-copyleft and missing metadata without an exact exception', () => {
  const lock = {
    lockfileVersion: 3,
    name: 'fixture',
    packages: {
      '': { license: 'MIT', version: '1.0.0' },
      'node_modules/strong-copy': { license: 'AGPL-3.0-only', version: '1.0.0' },
      'node_modules/unknown': { version: '1.0.0' },
    },
  };
  assert.throws(
    () => evaluateLicenseLock({ workspace: 'fixture', lock, policy, now: policyDate }),
    /unapproved package licenses/,
  );
});

test('secret gate detects provider tokens and production hardcoding but permits placeholders', () => {
  const awsKey = ['AKIA', '1234567890ABCDEF'].join('');
  assert.equal(findPotentialSecrets('src/config.js', `const value = '${awsKey}';`).length, 1);
  assert.equal(
    findPotentialSecrets('src/config.js', 'OPENAI_API_KEY = "real-looking-hardcoded-value";')
      .length,
    1,
  );
  assert.deepEqual(
    findPotentialSecrets('.env.example', 'OPENAI_API_KEY=\nDATABASE_URL=${DATABASE_URL}\n'),
    [],
  );
});

test('container gate requires immutable images and rejects privileged execution', () => {
  const digest = `sha256:${'a'.repeat(64)}`;
  assert.deepEqual(
    evaluateContainerFiles([
      { filePath: '.github/workflows/test.yml', text: `services:\n  db:\n    image: db@${digest}` },
    ]),
    { dockerfiles: 0, imageReferences: 1 },
  );
  assert.throws(
    () =>
      evaluateContainerFiles([
        {
          filePath: 'compose.yml',
          text: 'services:\n  app:\n    image: app:latest\n    privileged: true\n',
        },
      ]),
    /Container policy violations/,
  );
});

test('workflow gate accepts repository workflows and rejects floating actions', () => {
  for (const fileName of ['database.yml', 'quality.yml']) {
    assert.doesNotThrow(() =>
      evaluateWorkflowText(
        `.github/workflows/${fileName}`,
        readFileSync(path.join(repositoryRoot, '.github/workflows', fileName), 'utf8'),
      ),
    );
  }
  assert.throws(
    () =>
      evaluateWorkflowText(
        'fixture.yml',
        'name: fixture\non: push\npermissions:\n  contents: read\njobs:\n  test:\n    runs-on: ubuntu-latest\n    timeout-minutes: 5\n    steps:\n      - uses: actions/checkout@v6\n        with:\n          persist-credentials: false\n',
      ),
    /40-character commit SHA/,
  );
});

test('root scripts and quality workflow expose every P0F-S4 gate', () => {
  const packageJson = JSON.parse(readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'));
  for (const scriptName of [
    'openapi:check',
    'audit:check',
    'license:check',
    'secrets:check',
    'container:check',
    'workflow:check',
    'policy:check',
    'phase0:gate',
    'test:e2e',
    'test:database:integration',
  ]) {
    assert.equal(typeof packageJson.scripts[scriptName], 'string', scriptName);
  }

  const quality = readFileSync(path.join(repositoryRoot, '.github/workflows/quality.yml'), 'utf8');
  for (const marker of [
    'npm run format:check',
    'npm run lint',
    'npm run typecheck',
    'npm run test',
    'npm run build',
    'npm run openapi:check',
    'npm run audit:check',
    'npm run license:check',
    'npm run secrets:check',
    'npm run container:check',
    'npm run workflow:check',
    'npm run phase0:gate',
    'npm run test:e2e',
    'github/codeql-action/init@',
    'github/codeql-action/analyze@',
  ]) {
    assert.match(quality, new RegExp(marker.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('Phase 1 gate requires every Phase 0 prerequisite through P0F-S5 to be verified', () => {
  const tracker = readFileSync(
    path.join(repositoryRoot, 'docs/IMPLEMENTATION_PROGRESS.md'),
    'utf8',
  );
  assert.deepEqual(evaluatePhaseZeroTracker(tracker), { required: 35, verified: 35 });
  const blockedTracker = tracker.replace(
    /(\| P0F-S5[^\r\n]*?\|) VERIFIED (\|)/,
    '$1 IN_PROGRESS $2',
  );
  assert.throws(() => evaluatePhaseZeroTracker(blockedTracker), /P0F-S5/);
});
