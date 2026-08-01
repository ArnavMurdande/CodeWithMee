'use strict';

function parseAbsoluteOrigin(name, rawValue) {
  if (!rawValue?.trim()) return '';
  const value = rawValue.trim().replace(/\/$/, '');
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.origin !== value ||
    url.username ||
    url.password
  ) {
    throw new Error(`${name} must be an absolute credential-free HTTP(S) origin.`);
  }
  return url.origin;
}

function parseAbsoluteUrl(name, rawValue) {
  if (!rawValue?.trim()) return '';
  const url = new URL(rawValue.trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error(`${name} must be an absolute credential-free HTTP(S) URL.`);
  }
  return url.toString();
}

function requireSecretLength(name, value) {
  if (Buffer.byteLength(value) < 32) {
    throw new Error(`${name} must contain at least 32 bytes.`);
  }
}

function loadIdentityRuntimeConfig(
  environment = process.env,
  { allowedOrigins = [], nodeEnv = 'development' } = {},
) {
  const accessTokenSecret = environment.ACCESS_TOKEN_SECRET?.trim() || '';
  const refreshTokenPepper = environment.REFRESH_TOKEN_PEPPER?.trim() || '';
  const enabled = Boolean(accessTokenSecret && refreshTokenPepper);

  if (enabled) {
    requireSecretLength('ACCESS_TOKEN_SECRET', accessTokenSecret);
    requireSecretLength('REFRESH_TOKEN_PEPPER', refreshTokenPepper);
  } else if (accessTokenSecret || refreshTokenPepper) {
    throw new Error('ACCESS_TOKEN_SECRET and REFRESH_TOKEN_PEPPER must be configured together.');
  }

  const webAppOrigin = parseAbsoluteOrigin(
    'WEB_APP_ORIGIN',
    environment.WEB_APP_ORIGIN || allowedOrigins[0] || 'http://127.0.0.1:3000',
  );
  if (nodeEnv === 'production' && new URL(webAppOrigin).protocol !== 'https:') {
    throw new Error('WEB_APP_ORIGIN must use HTTPS in production.');
  }
  const trustedOrigins = Object.freeze(
    [...new Set([webAppOrigin, ...allowedOrigins])].filter(Boolean),
  );

  const googleClientId = environment.GOOGLE_OAUTH_CLIENT_ID?.trim() || '';
  const googleClientSecret = environment.GOOGLE_OAUTH_CLIENT_SECRET?.trim() || '';
  const googleRedirectUri = parseAbsoluteUrl(
    'GOOGLE_OAUTH_REDIRECT_URI',
    environment.GOOGLE_OAUTH_REDIRECT_URI,
  );
  const oauthTransactionSecret = environment.OAUTH_TRANSACTION_SECRET?.trim() || '';
  const googleParts = [
    googleClientId,
    googleClientSecret,
    googleRedirectUri,
    oauthTransactionSecret,
  ];
  const googleEnabled = googleParts.every(Boolean);
  const passwordCompromiseMode =
    environment.PASSWORD_COMPROMISE_CHECK_MODE?.trim() ||
    (nodeEnv === 'production' ? 'required' : 'local');
  if (!['local', 'best_effort', 'required'].includes(passwordCompromiseMode)) {
    throw new Error('PASSWORD_COMPROMISE_CHECK_MODE must be local, best_effort, or required.');
  }

  if (googleParts.some(Boolean) && !googleEnabled) {
    throw new Error(
      'Google OAuth requires client ID, client secret, redirect URI, and OAUTH_TRANSACTION_SECRET.',
    );
  }
  if (googleEnabled) requireSecretLength('OAUTH_TRANSACTION_SECRET', oauthTransactionSecret);
  if (
    googleEnabled &&
    nodeEnv === 'production' &&
    new URL(googleRedirectUri).protocol !== 'https:'
  ) {
    throw new Error('GOOGLE_OAUTH_REDIRECT_URI must use HTTPS in production.');
  }

  return Object.freeze({
    accessToken: Object.freeze({
      audience: environment.ACCESS_TOKEN_AUDIENCE?.trim() || 'codewithmee-web',
      issuer: environment.ACCESS_TOKEN_ISSUER?.trim() || 'codewithmee-api',
      secret: accessTokenSecret,
      ttlSeconds: 10 * 60,
    }),
    cookies: Object.freeze({
      csrfName: environment.CSRF_COOKIE_NAME?.trim() || 'cwm_csrf',
      oauthTransactionName: environment.OAUTH_TRANSACTION_COOKIE_NAME?.trim() || 'cwm_google_oauth',
      refreshName: environment.REFRESH_COOKIE_NAME?.trim() || 'cwm_refresh',
      secure: nodeEnv === 'production',
    }),
    enabled,
    google: Object.freeze({
      clientId: googleClientId,
      clientSecret: googleClientSecret,
      enabled: googleEnabled,
      redirectUri: googleRedirectUri,
      transactionSecret: oauthTransactionSecret,
    }),
    passwordCompromiseMode,
    refreshTokenPepper,
    session: Object.freeze({
      absoluteTtlMs: 30 * 24 * 60 * 60 * 1000,
      idleTtlMs: 7 * 24 * 60 * 60 * 1000,
      recentAuthenticationMs: 10 * 60 * 1000,
    }),
    trustedOrigins,
    webAppOrigin,
  });
}

module.exports = { loadIdentityRuntimeConfig };
