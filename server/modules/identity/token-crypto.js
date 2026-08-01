'use strict';

const {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} = require('node:crypto');

const jwt = require('jsonwebtoken');

const { ACCESS_TOKEN_CLAIMS } = require('./contracts');
const { IdentityError } = require('./errors');

function base64Url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function hashOpaqueToken(value, pepper) {
  return createHmac('sha256', pepper).update(value).digest('hex');
}

function constantTimeEqual(valueA, valueB) {
  const left = Buffer.from(String(valueA));
  const right = Buffer.from(String(valueB));
  return left.length === right.length && timingSafeEqual(left, right);
}

function createOpaqueToken(prefix, id = randomUUID()) {
  const secret = base64Url(randomBytes(32));
  return Object.freeze({ id, raw: `${prefix}.${id}.${secret}`, secret });
}

function parseOpaqueToken(raw, expectedPrefix) {
  if (typeof raw !== 'string') return null;
  const pieces = raw.split('.');
  if (pieces.length !== 3 || pieces[0] !== expectedPrefix || !pieces[1] || !pieces[2]) {
    return null;
  }
  return Object.freeze({ id: pieces[1], secret: pieces[2] });
}

function createAccessTokenService({ audience, issuer, secret, ttlSeconds = 600 }) {
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw new Error('ACCESS_TOKEN_SECRET must contain at least 32 bytes.');
  }

  return Object.freeze({
    issue({ sessionId, userId }) {
      return jwt.sign({ sid: sessionId }, secret, {
        algorithm: 'HS256',
        audience,
        expiresIn: ttlSeconds,
        issuer,
        subject: userId,
      });
    },

    verify(token) {
      let claims;
      try {
        claims = jwt.verify(token, secret, {
          algorithms: ['HS256'],
          audience,
          issuer,
        });
      } catch (error) {
        throw new IdentityError('invalid_access_token', 401, { cause: error });
      }

      if (
        typeof claims !== 'object' ||
        typeof claims.sub !== 'string' ||
        typeof claims.sid !== 'string' ||
        Object.keys(claims).some((claim) => !ACCESS_TOKEN_CLAIMS.includes(claim))
      ) {
        throw new IdentityError('invalid_access_token', 401);
      }

      return Object.freeze({ sessionId: claims.sid, userId: claims.sub });
    },
  });
}

function deriveEncryptionKey(secret) {
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw new Error('OAUTH_TRANSACTION_SECRET must contain at least 32 bytes.');
  }
  return createHash('sha256').update(secret).digest();
}

function encryptTransaction(payload, secret) {
  const key = deriveEncryptionKey(secret);
  const initializationVector = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, initializationVector);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `v1.${base64Url(initializationVector)}.${base64Url(ciphertext)}.${base64Url(tag)}`;
}

function decryptTransaction(value, secret) {
  try {
    const [version, encodedIv, encodedCiphertext, encodedTag] = String(value).split('.');
    if (version !== 'v1' || !encodedIv || !encodedCiphertext || !encodedTag) return null;

    const decipher = createDecipheriv(
      'aes-256-gcm',
      deriveEncryptionKey(secret),
      Buffer.from(encodedIv, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encodedCiphertext, 'base64url')),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString('utf8'));
  } catch {
    return null;
  }
}

function createPkcePair() {
  const verifier = base64Url(randomBytes(48));
  const challenge = base64Url(createHash('sha256').update(verifier).digest());
  return Object.freeze({ challenge, verifier });
}

module.exports = {
  constantTimeEqual,
  createAccessTokenService,
  createOpaqueToken,
  createPkcePair,
  decryptTransaction,
  encryptTransaction,
  hashOpaqueToken,
  parseOpaqueToken,
};
