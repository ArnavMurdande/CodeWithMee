'use strict';

const { randomBytes } = require('node:crypto');

const { IdentityError } = require('./errors');
const {
  constantTimeEqual,
  createPkcePair,
  decryptTransaction,
  encryptTransaction,
} = require('./token-crypto');

const GOOGLE_AUTHORIZATION_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const TRANSACTION_TTL_MS = 10 * 60 * 1000;

function randomValue(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

function safeReturnPath(value) {
  const candidate = String(value || '/auth/callback');
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.includes('\\')) {
    return '/auth/callback';
  }
  return candidate;
}

async function defaultIdTokenVerifier(idToken, { clientId, nonce }) {
  const { createRemoteJWKSet, jwtVerify } = await import('jose');
  const jwks = createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));
  const { payload } = await jwtVerify(idToken, jwks, {
    audience: clientId,
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
  });
  if (payload.nonce !== nonce) throw new IdentityError('invalid_google_identity', 401);
  return payload;
}

function createGoogleOidcClient({
  config,
  fetchImpl = fetch,
  idTokenVerifier = defaultIdTokenVerifier,
  now = () => new Date(),
}) {
  if (!config.enabled) {
    return Object.freeze({ enabled: false });
  }

  return Object.freeze({
    enabled: true,

    begin(returnTo) {
      const state = randomValue();
      const nonce = randomValue();
      const pkce = createPkcePair();
      const createdAt = now();
      const transactionCookie = encryptTransaction(
        {
          expiresAt: createdAt.getTime() + TRANSACTION_TTL_MS,
          nonce,
          returnTo: safeReturnPath(returnTo),
          state,
          verifier: pkce.verifier,
        },
        config.transactionSecret,
      );
      const authorizationUrl = new URL(GOOGLE_AUTHORIZATION_URL);
      authorizationUrl.searchParams.set('client_id', config.clientId);
      authorizationUrl.searchParams.set('code_challenge', pkce.challenge);
      authorizationUrl.searchParams.set('code_challenge_method', 'S256');
      authorizationUrl.searchParams.set('nonce', nonce);
      authorizationUrl.searchParams.set('prompt', 'select_account');
      authorizationUrl.searchParams.set('redirect_uri', config.redirectUri);
      authorizationUrl.searchParams.set('response_type', 'code');
      authorizationUrl.searchParams.set('scope', 'openid email profile');
      authorizationUrl.searchParams.set('state', state);
      return Object.freeze({
        authorizationUrl: authorizationUrl.toString(),
        maxAgeMs: TRANSACTION_TTL_MS,
        transactionCookie,
      });
    },

    async complete({ code, state, transactionCookie }) {
      const transaction = decryptTransaction(transactionCookie, config.transactionSecret);
      if (
        !transaction ||
        !code ||
        !state ||
        transaction.expiresAt <= now().getTime() ||
        !constantTimeEqual(state, transaction.state)
      ) {
        throw new IdentityError('invalid_google_transaction', 401);
      }

      const tokenResponse = await fetchImpl(GOOGLE_TOKEN_URL, {
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          code,
          code_verifier: transaction.verifier,
          grant_type: 'authorization_code',
          redirect_uri: config.redirectUri,
        }),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        method: 'POST',
        signal: AbortSignal.timeout(10_000),
      });
      if (!tokenResponse.ok) throw new IdentityError('google_exchange_failed', 502);
      const tokenPayload = await tokenResponse.json();
      if (!tokenPayload.id_token) throw new IdentityError('google_exchange_failed', 502);

      let claims;
      try {
        claims = await idTokenVerifier(tokenPayload.id_token, {
          clientId: config.clientId,
          nonce: transaction.nonce,
        });
      } catch (error) {
        if (error instanceof IdentityError) throw error;
        throw new IdentityError('invalid_google_identity', 401, { cause: error });
      }

      return Object.freeze({
        profile: Object.freeze({
          email: claims.email,
          emailVerified: claims.email_verified === true,
          name: claims.name || '',
          picture: claims.picture || null,
          subject: claims.sub,
        }),
        returnTo: safeReturnPath(transaction.returnTo),
      });
    },
  });
}

module.exports = { createGoogleOidcClient, safeReturnPath };
