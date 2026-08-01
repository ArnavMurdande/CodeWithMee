'use strict';

const { mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const { openApiDocument } = require('../modules/api/openapi');

const output = path.resolve(__dirname, '../../docs/openapi/codewithmee-v1.openapi.json');
mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(openApiDocument, null, 2)}\n`, {
  encoding: 'utf8',
  flag: 'w',
});
process.stdout.write(`${output}\n`);
