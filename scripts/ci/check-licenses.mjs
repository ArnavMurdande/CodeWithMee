import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '../..');

/** @param {string} lockPath @param {string} fallbackName */
function packageNameFromLockPath(lockPath, fallbackName) {
  const marker = 'node_modules/';
  const index = lockPath.lastIndexOf(marker);
  return index === -1 ? fallbackName : lockPath.slice(index + marker.length);
}

/** @param {any} exception */
function exceptionKey(exception) {
  return `${exception.workspace}:${exception.package}@${exception.version}`;
}

/** @param {any} exception @param {Date} now */
function assertUnexpired(exception, now) {
  const expiry = Date.parse(`${exception.expires}T23:59:59.999Z`);
  if (!Number.isFinite(expiry) || now.getTime() > expiry) {
    throw new Error(
      `License exception ${exceptionKey(exception)} expired on ${exception.expires}.`,
    );
  }
}

/** @param {{ workspace: string, lock: any, policy: any, now?: Date }} input */
export function evaluateLicenseLock({ workspace, lock, policy, now = new Date() }) {
  if (lock.lockfileVersion !== 3 || typeof lock.packages !== 'object') {
    throw new Error(`${workspace}: expected an npm lockfileVersion 3 package inventory.`);
  }

  const allowed = new Set(/** @type {string[]} */ (policy.allowedLicenses ?? []));
  const licenseExceptions = /** @type {any[]} */ (policy.licenseExceptions ?? []);
  const workspaceExceptions = licenseExceptions.filter(
    (exception) => exception.workspace === workspace,
  );
  workspaceExceptions.forEach((exception) => assertUnexpired(exception, now));
  const observed = new Set();
  const violations = [];
  let packages = 0;

  for (const [lockPath, metadata] of Object.entries(lock.packages)) {
    if (metadata.link) continue;
    packages += 1;
    const packageName = packageNameFromLockPath(lockPath, lock.name ?? workspace);
    const license = metadata.license ?? null;

    if (typeof license === 'string' && /(?:^|[^A-Z])(A?GPL|SSPL|BUSL)(?:-|\b)/i.test(license)) {
      violations.push(`${packageName}@${String(metadata.version)}:${license}`);
      continue;
    }
    if (typeof license === 'string' && allowed.has(license)) continue;

    const exception = workspaceExceptions.find(
      (candidate) =>
        candidate.package === packageName &&
        candidate.version === metadata.version &&
        candidate.license === license,
    );
    if (!exception) {
      violations.push(
        `${packageName}@${String(metadata.version)}:${license === null ? 'missing' : license}`,
      );
      continue;
    }
    observed.add(exceptionKey(exception));
  }

  const stale = workspaceExceptions.filter((exception) => !observed.has(exceptionKey(exception)));
  if (violations.length > 0) {
    throw new Error(`${workspace}: unapproved package licenses: ${violations.sort().join(', ')}.`);
  }
  if (stale.length > 0) {
    throw new Error(
      `${workspace}: remove stale license exceptions: ${stale.map(exceptionKey).sort().join(', ')}.`,
    );
  }

  return { exceptions: observed.size, packages };
}

export function runLicenseCheck() {
  const policy = JSON.parse(
    readFileSync(path.join(scriptDirectory, 'security-policy.json'), 'utf8'),
  );
  const workspaces = [
    ['root', path.join(repositoryRoot, 'package-lock.json')],
    ['client', path.join(repositoryRoot, 'client/package-lock.json')],
    ['server', path.join(repositoryRoot, 'server/package-lock.json')],
  ];
  let packages = 0;
  let exceptions = 0;

  for (const [workspace, lockPath] of workspaces) {
    const result = evaluateLicenseLock({
      workspace,
      lock: JSON.parse(readFileSync(lockPath, 'utf8')),
      policy,
    });
    packages += result.packages;
    exceptions += result.exceptions;
  }

  process.stdout.write(
    `License policy passed (${packages} lock entries, ${exceptions} exact reviewed exceptions).\n`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runLicenseCheck();
}
