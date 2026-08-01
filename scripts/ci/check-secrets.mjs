import { existsSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '../..');
const maximumTextBytes = 2 * 1024 * 1024;
const binaryExtensions = new Set([
  '.avif',
  '.gif',
  '.ico',
  '.jpeg',
  '.jpg',
  '.mp3',
  '.mp4',
  '.pdf',
  '.png',
  '.webm',
  '.webp',
  '.woff',
  '.woff2',
  '.zip',
]);

/** @type {Array<[string, RegExp]>} */
const tokenPatterns = [
  ['private-key', /-----BEGIN (?:EC |OPENSSH |RSA )?PRIVATE KEY-----/g],
  ['aws-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['github-token', /\bgh(?:p|o|u|s|r)_[A-Za-z0-9]{30,}\b/g],
  ['npm-token', /\bnpm_[A-Za-z0-9]{30,}\b/g],
  ['openai-key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/g],
  ['google-api-key', /\bAIza[A-Za-z0-9_-]{35}\b/g],
  ['stripe-live-key', /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b/g],
  ['slack-token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g],
];

const assignmentPattern =
  /\b([A-Z][A-Z0-9_]*(?:API_KEY|SECRET|PASSWORD|PRIVATE_KEY|DATABASE_URL|MONGO_URI))[ \t]*[:=][ \t]*(.*)$/;
const credentialUrlPattern =
  /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?):\/\/([^:\s/]+):([^@\s/]+)@([^/\s]+)/gi;

/** @param {string} text @param {number} index */
function lineNumberAt(text, index) {
  return text.slice(0, index).split('\n').length;
}

/** @param {string} value */
function isSafePlaceholder(value) {
  const normalized = value
    .trim()
    .replace(/["';]+$/, '')
    .toLowerCase();
  return (
    normalized.length === 0 ||
    normalized.startsWith('$') ||
    normalized.startsWith('process.env') ||
    /^(?:null|undefined|true|false)$/.test(normalized) ||
    /(?:changeme|dummy|example|fixture|placeholder|replace|sample|test|development|local-only)/.test(
      normalized,
    ) ||
    /(?:unconfigured|(?:^|[_-])ci(?:[_-]|$))/.test(normalized) ||
    /^[A-Z][A-Z0-9_]*[,;)]?$/.test(value.trim()) ||
    /^[x*._-]+$/.test(normalized)
  );
}

/** @param {string} filePath @param {string} text */
export function findPotentialSecrets(filePath, text) {
  const findings = [];
  const fixturePath = /(?:^|\/)(?:test|tests|fixtures)(?:\/|\.|$)/i.test(filePath);

  for (const [kind, pattern] of tokenPatterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      findings.push({ filePath, kind, line: lineNumberAt(text, match.index) });
    }
  }

  if (!fixturePath) {
    for (const [index, line] of text.split(/\r?\n/).entries()) {
      const match = line.match(assignmentPattern);
      if (!match) continue;
      const value = match[2].trim().replace(/^['"]|['"];?$/g, '');
      if (!isSafePlaceholder(value)) {
        findings.push({
          filePath,
          kind: `hardcoded-${match[1].toLowerCase()}`,
          line: index + 1,
        });
      }
    }
  }

  if (!fixturePath) {
    credentialUrlPattern.lastIndex = 0;
    for (const match of text.matchAll(credentialUrlPattern)) {
      const host = match[3].split(':')[0].toLowerCase();
      const localHost = host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
      const syntheticCredentials = isSafePlaceholder(match[1]) || isSafePlaceholder(match[2]);
      if (localHost && syntheticCredentials) continue;
      findings.push({
        filePath,
        kind: 'credentialed-database-url',
        line: lineNumberAt(text, match.index),
      });
    }
  }

  return findings;
}

function repositoryFiles() {
  const result = spawnSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
      windowsHide: true,
    },
  );
  if (result.status !== 0) {
    throw new Error('Unable to enumerate repository files for secret scanning.');
  }
  return result.stdout.split('\0').filter(Boolean);
}

export function runSecretCheck() {
  const findings = [];
  let scanned = 0;
  let oversized = 0;
  let binary = 0;

  for (const relativePath of repositoryFiles()) {
    const absolutePath = path.join(repositoryRoot, relativePath);
    if (!existsSync(absolutePath)) continue;
    if (binaryExtensions.has(path.extname(relativePath).toLowerCase())) {
      binary += 1;
      continue;
    }
    const size = statSync(absolutePath).size;
    if (size > maximumTextBytes) {
      oversized += 1;
      continue;
    }
    const buffer = readFileSync(absolutePath);
    if (buffer.includes(0)) continue;
    scanned += 1;
    findings.push(
      ...findPotentialSecrets(relativePath.replaceAll('\\', '/'), buffer.toString('utf8')),
    );
  }

  if (findings.length > 0) {
    const locations = findings
      .map((finding) => `${finding.filePath}:${finding.line}:${finding.kind}`)
      .sort();
    throw new Error(`Potential committed secrets found:\n${locations.join('\n')}`);
  }
  if (oversized > 0) {
    throw new Error(
      `${oversized} repository files exceed the ${maximumTextBytes}-byte secret-scan bound. Review or exclude them explicitly.`,
    );
  }

  process.stdout.write(
    `Secret policy passed (${scanned} text files, ${binary} recognized binary files, no oversized text).\n`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runSecretCheck();
}
