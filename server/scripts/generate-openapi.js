'use strict';

const fs = require('fs');
const path = require('path');
const { createOpenApiDocument } = require('../modules/api/openapi');

const doc = createOpenApiDocument();
const targetPath = path.join(__dirname, '../../docs/openapi/codewithmee-v1.openapi.json');

fs.mkdirSync(path.dirname(targetPath), { recursive: true });
fs.writeFileSync(targetPath, JSON.stringify(doc, null, 2) + '\n', 'utf-8');
console.log(`Updated OpenAPI specification at: ${targetPath}`);
