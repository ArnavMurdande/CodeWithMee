'use strict';

const { createHmac, randomBytes } = require('node:crypto');

const { PublicHttpError } = require('./error-handler');
const { requestSecurityProfile } = require('./route-security');

const DEFAULT_RATE_LIMITS = Object.freeze({
  administration: Object.freeze({ limit: 120, windowMs: 5 * 60 * 1000 }),
  authentication: Object.freeze({ limit: 30, windowMs: 15 * 60 * 1000 }),
  execution: Object.freeze({ limit: 30, windowMs: 60 * 1000 }),
  external: Object.freeze({ limit: 60, windowMs: 5 * 60 * 1000 }),
  read: Object.freeze({ limit: 1200, windowMs: 5 * 60 * 1000 }),
  upload: Object.freeze({ limit: 60, windowMs: 15 * 60 * 1000 }),
  write: Object.freeze({ limit: 300, windowMs: 5 * 60 * 1000 }),
});

class MemoryRateLimitStore {
  constructor({ maxKeys = 50_000 } = {}) {
    this.buckets = new Map();
    this.maxKeys = maxKeys;
  }

  cleanup(now) {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }

  async consume({ key, limit, now, windowMs }) {
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      if (!bucket && this.buckets.size >= this.maxKeys) this.cleanup(now);
      if (!bucket && this.buckets.size >= this.maxKeys) {
        const error = new Error('Rate limit store capacity exceeded.');
        error.code = 'rate_limit_store_unavailable';
        throw error;
      }
      bucket = { count: 0, resetAt: now + windowMs };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;
    return Object.freeze({
      allowed: bucket.count <= limit,
      remaining: Math.max(0, limit - bucket.count),
      resetAt: bucket.resetAt,
    });
  }
}

function clientRateKey(request, rateClass, secret) {
  const address = String(request.ip || request.socket?.remoteAddress || 'unknown');
  return createHmac('sha256', secret).update(`${rateClass}\0${address}`).digest('base64url');
}

function createRateLimitMiddleware({
  clock = () => Date.now(),
  keySecret = randomBytes(32),
  limits = DEFAULT_RATE_LIMITS,
  store = new MemoryRateLimitStore(),
} = {}) {
  if (!Buffer.isBuffer(keySecret) || keySecret.length < 32) {
    throw new Error('Rate-limit key secret must contain at least 32 bytes.');
  }
  return async function rateLimitMiddleware(request, response, next) {
    if (request.method === 'OPTIONS') return next();
    try {
      const profile =
        request.securityProfile || requestSecurityProfile(request.method, request.path);
      const policy = limits[profile.rateClass];
      if (!policy) throw new Error(`Missing rate-limit policy for ${profile.rateClass}.`);
      const now = clock();
      const result = await store.consume({
        key: clientRateKey(request, profile.rateClass, keySecret),
        limit: policy.limit,
        now,
        windowMs: policy.windowMs,
      });
      const resetSeconds = Math.max(1, Math.ceil((result.resetAt - now) / 1000));
      response.set({
        'ratelimit-limit': String(policy.limit),
        'ratelimit-remaining': String(result.remaining),
        'ratelimit-reset': String(resetSeconds),
      });
      if (!result.allowed) {
        response.set('retry-after', String(resetSeconds));
        return next(new PublicHttpError('rate_limit_exceeded', 429));
      }
      return next();
    } catch (error) {
      if (error instanceof PublicHttpError) return next(error);
      return next(new PublicHttpError('rate_limit_unavailable', 503, { cause: error }));
    }
  };
}

module.exports = {
  DEFAULT_RATE_LIMITS,
  MemoryRateLimitStore,
  clientRateKey,
  createRateLimitMiddleware,
};
