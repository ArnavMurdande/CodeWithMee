const path = require('path');
require('dotenv').config({ quiet: true, path: path.resolve(__dirname, '.env') });

const { startServer } = require('./start');
const { asStructuredLogger } = require('./modules/http/structured-logger');

let runtime;
const logger = asStructuredLogger(console, { environment: process.env.NODE_ENV || 'development' });

async function shutdown(signal) {
  if (!runtime) return;
  logger.info('server_shutdown_requested', { signal });
  await runtime.close();
}

startServer()
  .then((startedRuntime) => {
    runtime = startedRuntime;
    process.once('SIGINT', () => shutdown('SIGINT').finally(() => process.exit(0)));
    process.once('SIGTERM', () => shutdown('SIGTERM').finally(() => process.exit(0)));
  })
  .catch((error) => {
    logger.error('server_startup_failed', { errorCode: error.code || 'internal_error', message: error.message, stack: error.stack });
    process.exitCode = 1;
  });
