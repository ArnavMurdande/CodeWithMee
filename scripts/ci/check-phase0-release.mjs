import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '../..');

/** @param {string} text */
export function evaluatePhaseZeroTracker(text) {
  const statuses = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!/^\| P0[A-F]-S\d+\s+\|/.test(line)) continue;
    const cells = line.split('|').map((cell) => cell.trim());
    statuses.set(cells[1], cells[5]);
  }
  const required = [];
  for (const phase of ['A', 'B', 'C', 'D', 'E']) {
    for (let step = 1; step <= 6; step += 1) required.push(`P0${phase}-S${step}`);
  }
  for (let step = 1; step <= 5; step += 1) required.push(`P0F-S${step}`);
  const blocked = required.filter((id) => statuses.get(id) !== 'VERIFIED');
  if (blocked.length > 0) {
    throw new Error(`Phase 1 is blocked by unverified Phase 0 items: ${blocked.join(', ')}.`);
  }
  return Object.freeze({ required: required.length, verified: required.length });
}

export function runPhaseZeroGate() {
  const requiredDocuments = [
    'docs/CODEWITHMEE_AUDIT.md',
    'docs/IMPLEMENTATION_PLAN.md',
    'docs/ARCHITECTURE.md',
    'docs/DATABASE_PLAN.md',
    'docs/API_PLAN.md',
    'docs/SECURITY_PLAN.md',
    'docs/DEPLOYMENT_PLAN.md',
    'docs/PHASE_0_RELEASE_GATE.md',
    'docs/baselines/P0F-S1_TEST_FOUNDATION.md',
    'docs/baselines/P0F-S2_DATABASE_TEST_LIFECYCLE.md',
    'docs/baselines/P0F-S3_BROWSER_E2E.md',
    'docs/baselines/P0F-S4_CI_GATES.md',
    'docs/baselines/P0F-S5_OBSERVABILITY.md',
  ];
  const missing = requiredDocuments.filter(
    (relativePath) => !existsSync(path.join(repositoryRoot, relativePath)),
  );
  if (missing.length > 0) throw new Error(`Phase 0 evidence is missing: ${missing.join(', ')}.`);
  const result = evaluatePhaseZeroTracker(
    readFileSync(path.join(repositoryRoot, 'docs/IMPLEMENTATION_PROGRESS.md'), 'utf8'),
  );
  process.stdout.write(
    `Phase 0 implementation gate passed (${result.verified}/${result.required} prerequisite items verified). Production release remains governed by docs/PHASE_0_RELEASE_GATE.md.\n`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runPhaseZeroGate();
}
