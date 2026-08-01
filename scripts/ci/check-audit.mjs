import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '../..');

function loadPolicy() {
  return JSON.parse(readFileSync(path.join(scriptDirectory, 'security-policy.json'), 'utf8'));
}

/**
 * @param {string} packageName
 * @param {Record<string, any>} vulnerabilities
 * @param {Set<string>} [visited]
 * @returns {any[]}
 */
function advisoryObjectsFor(packageName, vulnerabilities, visited = new Set()) {
  if (visited.has(packageName)) return [];
  visited.add(packageName);
  const vulnerability = vulnerabilities[packageName];
  if (!vulnerability) return [];

  const via = /** @type {any[]} */ (vulnerability.via ?? []);
  return via.flatMap((entry) => {
    if (typeof entry === 'string') {
      return advisoryObjectsFor(entry, vulnerabilities, visited);
    }
    return [entry];
  });
}

/** @param {any} exception */
function exceptionKey(exception) {
  return `${exception.workspace}:${exception.advisoryUrl}:${exception.source}`;
}

/** @param {any} exception @param {Date} now */
function assertUnexpired(exception, now) {
  const expiry = Date.parse(`${exception.expires}T23:59:59.999Z`);
  if (!Number.isFinite(expiry) || now.getTime() > expiry) {
    throw new Error(
      `Security exception ${exceptionKey(exception)} expired on ${String(exception.expires)}.`,
    );
  }
}

/** @param {{ workspace: string, report: any, policy: any, now?: Date }} input */
export function evaluateAuditReport({ workspace, report, policy, now = new Date() }) {
  if (report.auditReportVersion !== 2 || typeof report.vulnerabilities !== 'object') {
    throw new Error(`${workspace}: unsupported npm audit report.`);
  }

  const auditExceptions = /** @type {any[]} */ (policy.auditExceptions ?? []);
  const workspaceExceptions = auditExceptions.filter(
    (exception) => exception.workspace === workspace,
  );
  workspaceExceptions.forEach((exception) => assertUnexpired(exception, now));
  const observed = new Set();
  const violations = [];

  for (const [packageName, vulnerability] of Object.entries(report.vulnerabilities)) {
    const advisories = advisoryObjectsFor(packageName, report.vulnerabilities);
    const matchingException = workspaceExceptions.find(
      (exception) =>
        exception.packages.includes(packageName) &&
        vulnerability.severity === exception.severity &&
        advisories.length > 0 &&
        advisories.every(
          (advisory) =>
            advisory.url === exception.advisoryUrl && advisory.source === exception.source,
        ),
    );

    if (!matchingException) {
      violations.push(`${packageName}:${String(vulnerability.severity)}`);
      continue;
    }
    observed.add(exceptionKey(matchingException));
  }

  const stale = workspaceExceptions.filter((exception) => !observed.has(exceptionKey(exception)));
  if (violations.length > 0) {
    throw new Error(
      `${workspace}: unapproved npm audit findings: ${violations.sort().join(', ')}.`,
    );
  }
  if (stale.length > 0) {
    throw new Error(
      `${workspace}: remove stale audit exceptions: ${stale.map(exceptionKey).sort().join(', ')}.`,
    );
  }

  return {
    exceptions: observed.size,
    vulnerabilities: Object.keys(report.vulnerabilities).length,
  };
}

/** @param {string} workspace @param {string} directory */
function runNpmAudit(workspace, directory) {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) {
    throw new Error(`${workspace}: npm_execpath is unavailable; run this check through npm.`);
  }
  const result = spawnSync(process.execPath, [npmCli, 'audit', '--json'], {
    cwd: directory,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    windowsHide: true,
  });

  if (!result.stdout) {
    throw new Error(
      `${workspace}: npm audit produced no JSON (${result.error?.message ?? 'unknown error'}).`,
    );
  }

  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error(`${workspace}: npm audit returned invalid JSON.`);
  }

  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`${workspace}: npm audit failed with exit ${String(result.status)}.`);
  }
  return report;
}

export function runAuditCheck() {
  const policy = loadPolicy();
  const workspaces = [
    ['root', repositoryRoot],
    ['client', path.join(repositoryRoot, 'client')],
    ['server', path.join(repositoryRoot, 'server')],
  ];
  let total = 0;
  let exceptions = 0;

  for (const [workspace, directory] of workspaces) {
    const result = evaluateAuditReport({
      workspace,
      report: runNpmAudit(workspace, directory),
      policy,
    });
    total += result.vulnerabilities;
    exceptions += result.exceptions;
  }

  process.stdout.write(
    `Dependency audit policy passed (${total} vulnerability nodes, ${exceptions} exact reviewed exception).\n`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runAuditCheck();
}
