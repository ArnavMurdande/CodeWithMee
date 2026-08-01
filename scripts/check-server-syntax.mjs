import { readdir } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repositoryRoot = resolve(import.meta.dirname, '..');
const serverRoot = resolve(repositoryRoot, 'server');
const ignoredDirectories = new Set(['node_modules', 'uploads']);

/**
 * @param {string} directory
 * @returns {Promise<string[]>}
 */
async function collectJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
      continue;
    }

    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectJavaScriptFiles(absolutePath)));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(absolutePath);
    }
  }

  return files;
}

const files = await collectJavaScriptFiles(serverRoot);
const failures = [];

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    failures.push({
      file: relative(repositoryRoot, file),
      output: `${result.stdout}${result.stderr}`.trim(),
    });
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`${failure.file}: ${failure.output}`);
  }
  console.error(`Server syntax check failed for ${failures.length} of ${files.length} files.`);
  process.exitCode = 1;
} else {
  console.log(`Server syntax verified for ${files.length} JavaScript files.`);
}
