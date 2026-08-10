'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env'), quiet: true });
require('dotenv').config({ quiet: true });

const { connectDatabase, disconnectDatabase } = require('../database');
const { asStructuredLogger } = require('../modules/http/structured-logger');
const { createPostgresIdentityRepository } = require('../modules/identity/postgres-repository');

function normalizeEmail(value) {
  return String(value || '')
    .trim()
    .normalize('NFKC')
    .toLowerCase();
}

function parseArgs(args) {
  let email = '';
  let apply = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--email' && args[i + 1]) {
      email = args[i + 1];
      i++;
    } else if (args[i].startsWith('--email=')) {
      email = args[i].slice('--email='.length);
    } else if (args[i] === '--apply') {
      apply = true;
    }
  }

  return { apply, email: normalizeEmail(email) };
}

async function runDeleteTestUser({
  args = process.argv.slice(2),
  environment = process.env,
  logger = console,
} = {}) {
  const nodeEnv = environment.NODE_ENV?.trim() || 'development';
  if (nodeEnv !== 'development') {
    throw new Error('delete-test-user script requires NODE_ENV=development.');
  }

  const { apply, email } = parseArgs(args);
  if (!email) {
    throw new Error('Usage: node scripts/delete-test-user.js --email <email> [--apply]');
  }

  const structuredLogger = asStructuredLogger(logger, { environment: nodeEnv });

  const database = await connectDatabase({
    logger: structuredLogger,
    postgresRequired: true,
    postgresUri: environment.DATABASE_URL,
  });

  try {
    const repository = createPostgresIdentityRepository(database.postgres.pool);
    const user = await repository.findUserByEmail(email);

    if (!user) {
      structuredLogger.info('user_not_found', { email });
      return { deleted: false, email, reason: 'user_not_found' };
    }

    const recordSummary = {
      email: user.email,
      userId: String(user.id),
      users: 1,
    };

    if (!apply) {
      structuredLogger.info('delete_test_user_dry_run', recordSummary);
      return { apply: false, recordSummary };
    }

    const expectedApproval = `delete:${email}`;
    const actualApproval = environment.DELETE_TEST_USER_APPROVAL?.trim();
    if (actualApproval !== expectedApproval) {
      throw new Error(
        `Missing or invalid DELETE_TEST_USER_APPROVAL. Required: DELETE_TEST_USER_APPROVAL=${expectedApproval}`,
      );
    }

    await database.postgres.pool.query('DELETE FROM users WHERE id = $1', [user.id]);
    const deleteResults = { users: 1 };

    structuredLogger.info('delete_test_user_applied', {
      deletedCounts: deleteResults,
      email: user.email,
      userId: String(user.id),
    });

    return { apply: true, deletedCounts: deleteResults, recordSummary };
  } finally {
    await disconnectDatabase(database);
  }
}

if (require.main === module) {
  runDeleteTestUser()
    .then((result) => {
      if (!result.apply && result.recordSummary) {
        console.log('\n--- DRY RUN SUMMARY ---');
        console.log(JSON.stringify(result.recordSummary, null, 2));
        console.log('\nTo execute deletion, run:');
        console.log(
          `DELETE_TEST_USER_APPROVAL=delete:${result.recordSummary.email} node scripts/delete-test-user.js --email ${result.recordSummary.email} --apply\n`,
        );
      } else if (result.apply) {
        console.log('\n--- DELETION COMPLETE ---');
        console.log(JSON.stringify(result.deletedCounts, null, 2));
      }
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n[ERROR]', error.message);
      process.exit(1);
    });
}

module.exports = { runDeleteTestUser };
