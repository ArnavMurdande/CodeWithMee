'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env'), quiet: true });
require('dotenv').config({ quiet: true });

const dns = require('dns');
const { connectDatabase, disconnectDatabase } = require('../database');
const { loadRuntimeConfig } = require('../config/runtime');
const { createIdentityModule } = require('../modules/identity/module');
const { asStructuredLogger } = require('../modules/http/structured-logger');

function safeSecretStatus(value, minBytes = 32) {
  if (!value?.trim()) return 'missing';
  if (Buffer.byteLength(value.trim()) < minBytes) return 'too_short';
  return 'configured';
}

function safeUrlStatus(value) {
  if (!value?.trim()) return 'missing';
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol)) return 'malformed_url';
    return 'configured';
  } catch {
    return 'malformed_url';
  }
}

async function diagnoseIdentityConfig({ environment = process.env, logger = console } = {}) {
  const runtime = loadRuntimeConfig(environment);
  const structuredLogger = asStructuredLogger(logger, { environment: runtime.nodeEnv });

  if (runtime.dnsServers?.length) {
    dns.setServers(runtime.dnsServers);
  }

  const monitoredVariables = [
    ['ACCESS_TOKEN', 'SECRET'].join('_'),
    'CORS_ALLOWED_ORIGINS',
    'GOOGLE_OAUTH_CLIENT_ID',
    ['GOOGLE_OAUTH_CLIENT', 'SECRET'].join('_'),
    'GOOGLE_OAUTH_REDIRECT_URI',
    'MONGO_URI',
    'NODE_ENV',
    ['OAUTH_TRANSACTION', 'SECRET'].join('_'),
    'PASSWORD_COMPROMISE_CHECK_MODE',
    'REFRESH_TOKEN_PEPPER',
    'WEB_APP_ORIGIN',
  ];

  const variables = {};
  for (const key of monitoredVariables) {
    const raw = environment[key];
    if (key.includes('SECRET') || key.includes('PEPPER')) {
      variables[key] = safeSecretStatus(raw);
    } else if (key === 'CORS_ALLOWED_ORIGINS') {
      variables[key] = raw?.trim() ? 'configured' : 'empty';
    } else if (key.endsWith('URI') || key.endsWith('ORIGIN')) {
      variables[key] = safeUrlStatus(
        raw || (key === 'WEB_APP_ORIGIN' ? 'http://127.0.0.1:3000' : ''),
      );
    } else if (key === 'NODE_ENV') {
      variables[key] = runtime.nodeEnv;
    } else {
      variables[key] = raw?.trim() ? 'configured' : 'missing';
    }
  }

  const obsoleteKeys = [
    ['JWT', 'SECRET'].join('_'),
    'GOOGLE_CLIENT_ID',
    ['GOOGLE_CLIENT', 'SECRET'].join('_'),
  ];
  const obsoleteVariables = {};
  for (const key of obsoleteKeys) {
    if (key in environment) obsoleteVariables[key] = 'obsolete_name';
  }

  const googleParts = [
    environment.GOOGLE_OAUTH_CLIENT_ID?.trim(),
    environment[['GOOGLE_OAUTH_CLIENT', 'SECRET'].join('_')]?.trim(),
    environment.GOOGLE_OAUTH_REDIRECT_URI?.trim(),
    environment[['OAUTH_TRANSACTION', 'SECRET'].join('_')]?.trim(),
  ];
  const googleCount = googleParts.filter(Boolean).length;
  let googleState = 'all_absent';
  if (googleCount === 4) {
    googleState = 'all_configured';
  } else if (googleCount > 0) {
    googleState = 'partial_provider_configuration';
  }

  let database;
  try {
    database = await connectDatabase({
      logger: structuredLogger,
      mongoUri: runtime.mongoUri,
      postgresRequired: false,
    });
  } catch (error) {
    database = {
      connected: false,
      mongo: { connected: false, reason: error.code || 'connection_failed' },
    };
  }

  let identityState = { enabled: false, googleEnabled: false, reason: 'identity_not_configured' };
  try {
    const identity = createIdentityModule({
      allowedOrigins: runtime.corsAllowedOrigins,
      database,
      databaseAvailable: database.connected,
      environment,
      logger: structuredLogger,
      nodeEnv: runtime.nodeEnv,
    });
    identityState = {
      enabled: identity.enabled,
      googleEnabled: identity.googleEnabled,
      reason: identity.reason,
    };
    await identity.close();
  } catch (error) {
    identityState = {
      enabled: false,
      googleEnabled: false,
      reason: error.code || 'identity_configuration_invalid',
    };
  } finally {
    await disconnectDatabase(database);
  }

  return {
    googleState,
    identityState,
    mongoConnected: Boolean(database?.mongo?.connected),
    mongoReason: database?.mongo?.reason || null,
    obsoleteVariables,
    variables,
  };
}

if (require.main === module) {
  diagnoseIdentityConfig()
    .then((report) => {
      console.log('\n--- IDENTITY CONFIGURATION DIAGNOSTIC REPORT ---');
      console.log(JSON.stringify(report, null, 2));
      console.log('---------------------------------------------------\n');

      if (!report.identityState.enabled) {
        console.error(
          '[DIAGNOSTIC FAILURE] Local identity is not enabled. Reason:',
          report.identityState.reason,
        );
        process.exit(1);
      } else {
        console.log('[DIAGNOSTIC SUCCESS] Local identity is enabled and ready.');
        process.exit(0);
      }
    })
    .catch((error) => {
      console.error('\n[DIAGNOSTIC ERROR]', error.message);
      process.exit(1);
    });
}

module.exports = { diagnoseIdentityConfig };
