import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '../..');
const require = createRequire(import.meta.url);

/** @param {unknown} document */
export function serializeOpenApi(document) {
  return `${JSON.stringify(document, null, 2)}\n`;
}

/** @param {{ actualDocument: any, artifactText: string }} input */
export function checkOpenApiArtifact({ actualDocument, artifactText }) {
  const expected = serializeOpenApi(actualDocument);
  if (artifactText !== expected) {
    throw new Error(
      'OpenAPI artifact drifted from the executable contract. Run npm run openapi:export and review the diff.',
    );
  }

  const parsed = JSON.parse(artifactText);
  if (parsed.openapi !== '3.1.1') {
    throw new Error(`Expected OpenAPI 3.1.1, received ${String(parsed.openapi)}.`);
  }

  return {
    operations: Object.values(parsed.paths ?? {}).reduce(
      (count, pathItem) =>
        count +
        Object.keys(pathItem).filter((method) =>
          ['delete', 'get', 'head', 'options', 'patch', 'post', 'put', 'trace'].includes(method),
        ).length,
      0,
    ),
    paths: Object.keys(parsed.paths ?? {}).length,
  };
}

export function runOpenApiCheck() {
  const modulePath = path.join(repositoryRoot, 'server/modules/api/openapi.js');
  const { openApiDocument } = require(modulePath);
  const artifactPath = path.join(repositoryRoot, 'docs/openapi/codewithmee-v1.openapi.json');
  const result = checkOpenApiArtifact({
    actualDocument: openApiDocument,
    artifactText: readFileSync(artifactPath, 'utf8'),
  });
  process.stdout.write(
    `OpenAPI artifact matches executable contract (${result.paths} paths, ${result.operations} operations).\n`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runOpenApiCheck();
}
