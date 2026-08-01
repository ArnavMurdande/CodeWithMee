'use strict';

const { runSyntheticHealth } = require('../modules/observability/synthetic-health');

runSyntheticHealth({ baseUrl: process.env.SYNTHETIC_BASE_URL })
  .then((results) => {
    process.stdout.write(`Synthetic health passed (${results.length} checks).\n`);
  })
  .catch((error) => {
    process.stderr.write(`Synthetic health failed: ${error.message}\n`);
    process.exitCode = 1;
  });
