import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '../..');
const digestPattern = /@sha256:[a-f0-9]{64}$/;

/** @param {string} filePath */
function isDockerfile(filePath) {
  const name = path.basename(filePath).toLowerCase();
  return name === 'dockerfile' || name.startsWith('dockerfile.') || name.endsWith('.dockerfile');
}

/** @param {string} filePath */
function isComposeFile(filePath) {
  const name = path.basename(filePath).toLowerCase();
  return /^(?:docker-)?compose(?:\.[a-z0-9_-]+)?\.ya?ml$/.test(name);
}

/** @param {string} value */
function cleanImage(value) {
  return value.replace(/^['"]|['"]$/g, '');
}

/** @param {Array<{ filePath: string, text: string }>} files */
export function evaluateContainerFiles(files) {
  const violations = [];
  let dockerfiles = 0;
  let imageReferences = 0;

  for (const file of files) {
    const normalizedPath = file.filePath.replaceAll('\\', '/');
    const dockerfile = isDockerfile(normalizedPath);
    const compose = isComposeFile(normalizedPath);
    const workflow = /^\.github\/workflows\/.*\.ya?ml$/i.test(normalizedPath);
    if (!dockerfile && !compose && !workflow) continue;

    if (/\bprivileged\s*:\s*true\b/i.test(file.text)) {
      violations.push(`${normalizedPath}: privileged containers are forbidden`);
    }
    if (/\bnetwork_mode\s*:\s*host\b/i.test(file.text)) {
      violations.push(`${normalizedPath}: host networking is forbidden`);
    }
    if (/(?:^|[\s:'"])(?:\/var\/run\/docker\.sock)(?=$|[\s:'"])/im.test(file.text)) {
      violations.push(`${normalizedPath}: mounting the Docker socket is forbidden`);
    }

    if (dockerfile) {
      dockerfiles += 1;
      const lines = file.text.split(/\r?\n/);
      const fromIndexes = [];
      let lastUser = null;
      for (const [index, line] of lines.entries()) {
        const from = line.match(/^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)/i);
        if (from) {
          fromIndexes.push(index);
          imageReferences += 1;
          const image = cleanImage(from[1]);
          if (image !== 'scratch' && !digestPattern.test(image)) {
            violations.push(`${normalizedPath}:${index + 1}: base image must use a sha256 digest`);
          }
          lastUser = null;
        }
        const user = line.match(/^\s*USER\s+(\S+)/i);
        if (user) lastUser = user[1].toLowerCase();
        if (/^\s*ADD\s+https?:\/\//i.test(line)) {
          violations.push(`${normalizedPath}:${index + 1}: remote ADD is forbidden`);
        }
        if (/(?:curl|wget)[^\n|]*\|\s*(?:ba)?sh\b/i.test(line)) {
          violations.push(`${normalizedPath}:${index + 1}: pipe-to-shell is forbidden`);
        }
      }
      if (fromIndexes.length === 0) {
        violations.push(`${normalizedPath}: Dockerfile has no FROM instruction`);
      } else if (!lastUser || lastUser === 'root' || lastUser === '0') {
        violations.push(`${normalizedPath}: final stage must declare a non-root USER`);
      }
    }

    if (compose || workflow) {
      for (const [index, line] of file.text.split(/\r?\n/).entries()) {
        const imageMatch = line.match(/^\s*image\s*:\s*([^\s#]+)/i);
        if (!imageMatch) continue;
        imageReferences += 1;
        const image = cleanImage(imageMatch[1]);
        if (!digestPattern.test(image)) {
          violations.push(`${normalizedPath}:${index + 1}: image must use a sha256 digest`);
        }
      }
    }
  }

  if (violations.length > 0) {
    throw new Error(`Container policy violations:\n${violations.sort().join('\n')}`);
  }
  return { dockerfiles, imageReferences };
}

function repositoryFiles() {
  const result = spawnSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: repositoryRoot, encoding: 'utf8', windowsHide: true },
  );
  if (result.status !== 0) throw new Error('Unable to enumerate repository container files.');
  return result.stdout
    .split('\0')
    .filter(Boolean)
    .filter((filePath) => existsSync(path.join(repositoryRoot, filePath)))
    .map((filePath) => ({
      filePath: filePath.replaceAll('\\', '/'),
      text: readFileSync(path.join(repositoryRoot, filePath), 'utf8'),
    }));
}

export function runContainerCheck() {
  const result = evaluateContainerFiles(repositoryFiles());
  process.stdout.write(
    `Container policy passed (${result.dockerfiles} deployable Dockerfiles, ${result.imageReferences} pinned image references).\n`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runContainerCheck();
}
