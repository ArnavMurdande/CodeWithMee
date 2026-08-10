'use strict';

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { createExecutionGateway } = require('../modules/execution/runner-gateway');

async function main() {
  const runnerUrl = process.env.PISTON_RUNNER_URL || process.env.PISTON_API_URL;
  const gateway = createExecutionGateway({
    hmacSecret: process.env.RUNNER_HMAC_SECRET,
    runnerUrl,
  });
  const result = await gateway.executeJob(
    'r',
    [
      '# R sandbox smoke test',
      'greet <- function(name) paste("Hello,", name, "!")',
      'cat(greet("CodeWithMee"), "\\n")',
      'cat("Mean:", mean(c(1, 2, 3, 4, 5)), "\\n")',
    ].join('\n'),
  );
  console.log(JSON.stringify({
    configured: Boolean(runnerUrl),
    exitCode: result.exitCode,
    stderr: result.stderr,
    stdout: result.stdout,
  }));
}

main().catch((error) => {
  const runnerUrl = process.env.PISTON_RUNNER_URL || process.env.PISTON_API_URL;
  const parsed = runnerUrl ? new URL(runnerUrl) : null;
  console.error(JSON.stringify({
    code: error.code || 'runner_smoke_failed',
    message: error.message,
    cause: error.cause?.message,
    runner: parsed ? `${parsed.host}${parsed.pathname}` : null,
  }));
  process.exitCode = 1;
});
