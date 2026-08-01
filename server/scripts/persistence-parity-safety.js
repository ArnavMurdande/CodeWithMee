'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function databaseName(databaseUrl) {
  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL must be an absolute PostgreSQL URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('DATABASE_URL must use PostgreSQL.');
  }
  const name = decodeURIComponent(url.pathname.replace(/^\//, '')).trim();
  if (!/^[a-zA-Z0-9_-]{1,63}$/.test(name)) throw new Error('DATABASE_URL database name is unsafe.');
  return name;
}

function assertPrivateOutput(rawPath) {
  if (!rawPath?.trim()) throw new Error('--output is required.');
  const outputPath = path.resolve(rawPath.trim());
  if (path.extname(outputPath).toLowerCase() !== '.json') {
    throw new Error('Parity output must be a .json file.');
  }
  if (fs.existsSync(outputPath)) throw new Error('Parity output already exists.');
  const parent = path.dirname(outputPath);
  const parentStat = fs.lstatSync(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
    throw new Error('Parity output parent must be an existing non-symlink directory.');
  }
  return outputPath;
}

function assertParitySafety({ datasetSha256, environment, output }) {
  if (!SHA256_PATTERN.test(datasetSha256 || '')) {
    throw new Error('--dataset-sha256 must be a lowercase SHA-256.');
  }
  if (environment.PERSISTENCE_PARITY_MODE !== 'read_only') {
    throw new Error('PERSISTENCE_PARITY_MODE must be read_only.');
  }
  const name = databaseName(environment.DATABASE_URL || '');
  const expected = `parity:${name}:${datasetSha256}`;
  if (environment.PERSISTENCE_PARITY_APPROVAL?.trim() !== expected) {
    throw new Error(`PERSISTENCE_PARITY_APPROVAL must exactly equal ${expected}.`);
  }
  return Object.freeze({ databaseName: name, outputPath: assertPrivateOutput(output) });
}

module.exports = { assertParitySafety, databaseName };
