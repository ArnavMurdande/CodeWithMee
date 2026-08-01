import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '../..');
const workflowDirectory = path.join(repositoryRoot, '.github/workflows');

/** @param {string} filePath @param {string} text */
export function evaluateWorkflowText(filePath, text) {
  const violations = [];
  if (/^\s*pull_request_target\s*:/m.test(text)) {
    violations.push(`${filePath}: pull_request_target is forbidden`);
  }
  if (/^\s*permissions\s*:\s*(?:write-all|read-all)\s*$/m.test(text)) {
    violations.push(`${filePath}: broad permission presets are forbidden`);
  }

  const beforeJobs = text.split(/^jobs\s*:/m)[0];
  if (
    !/^permissions\s*:\s*$/m.test(beforeJobs) ||
    !/^\s{2}contents\s*:\s*read\s*$/m.test(beforeJobs)
  ) {
    violations.push(`${filePath}: top-level contents: read permission is required`);
  }

  const actionLines = [...text.matchAll(/^\s*-?\s*uses\s*:\s*([^\s#]+)(?:\s+#.*)?$/gm)];
  for (const match of actionLines) {
    const action = match[1];
    if (action.startsWith('./')) continue;
    const separator = action.lastIndexOf('@');
    const reference = separator === -1 ? '' : action.slice(separator + 1);
    if (!/^[a-f0-9]{40}$/.test(reference)) {
      violations.push(`${filePath}: external action must be pinned to a 40-character commit SHA`);
    }
  }

  const runners = (text.match(/^\s{4}runs-on\s*:/gm) ?? []).length;
  const timeouts = (text.match(/^\s{4}timeout-minutes\s*:/gm) ?? []).length;
  if (runners === 0 || timeouts !== runners) {
    violations.push(`${filePath}: every runnable job must declare timeout-minutes`);
  }

  if (/actions\/checkout@/.test(text) && !/^\s+persist-credentials\s*:\s*false\s*$/m.test(text)) {
    violations.push(`${filePath}: checkout must disable persisted credentials`);
  }

  if (violations.length > 0) {
    throw new Error(`Workflow policy violations:\n${violations.sort().join('\n')}`);
  }
  return { actions: actionLines.length, jobs: runners };
}

export function runWorkflowCheck() {
  const workflowFiles = readdirSync(workflowDirectory)
    .filter((fileName) => /\.ya?ml$/i.test(fileName))
    .sort();
  if (workflowFiles.length === 0) throw new Error('No GitHub Actions workflows exist.');

  let actions = 0;
  let jobs = 0;
  for (const fileName of workflowFiles) {
    const result = evaluateWorkflowText(
      `.github/workflows/${fileName}`,
      readFileSync(path.join(workflowDirectory, fileName), 'utf8'),
    );
    actions += result.actions;
    jobs += result.jobs;
  }

  const qualityText = readFileSync(path.join(workflowDirectory, 'quality.yml'), 'utf8');
  const requiredMarkers = [
    'npm run format:check',
    'npm run format:check:e2e',
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
  ];
  const missing = requiredMarkers.filter((marker) => !qualityText.includes(marker));
  if (missing.length > 0) {
    throw new Error(`Quality workflow is missing gates: ${missing.join(', ')}.`);
  }

  process.stdout.write(
    `Workflow policy passed (${workflowFiles.length} workflows, ${jobs} job blocks, ${actions} pinned actions).\n`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runWorkflowCheck();
}
