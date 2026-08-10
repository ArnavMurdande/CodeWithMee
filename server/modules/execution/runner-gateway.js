'use strict';

const crypto = require('node:crypto');

const DEFAULT_HMAC_SECRET = 'dev_runner_hmac_secret_key_32_bytes_min';
const PISTON_LANGUAGE_MAP = Object.freeze({ cpp: 'c++', r: 'rscript', sqlite: 'sqlite3' });

/**
 * Validates HMAC secret for production environment.
 */
function validateSecret(secret, isProduction) {
  if (isProduction && (!secret || secret === DEFAULT_HMAC_SECRET || secret.length < 32)) {
    throw new Error('RUNNER_HMAC_SECRET must be configured with at least 32 random characters in production.');
  }
  return secret || DEFAULT_HMAC_SECRET;
}

/**
 * Creates HMAC signature for code execution job payload.
 */
function signJobPayload(payload, secret, options = {}) {
  const timestamp = options.timestamp || Date.now();
  const nonce = options.nonce || crypto.randomUUID();
  const expiry = options.expiry || timestamp + 30000;
  const payloadDigest = crypto
    .createHash('sha256')
    .update(typeof payload === 'string' ? payload : JSON.stringify(payload))
    .digest('hex');

  const jobId = options.jobId || 'job';
  const raw = `${jobId}:${timestamp}:${nonce}:${payloadDigest}`;
  const signature = crypto.createHmac('sha256', secret).update(raw).digest('hex');

  return {
    signature,
    timestamp,
    nonce,
    expiry,
    payloadDigest,
  };
}

/**
 * Verifies HMAC signature for code execution result.
 */
function verifyResultSignature(resultPayload, signature, timestamp, nonce, secret, options = {}) {
  if (!signature || !timestamp || !nonce) return false;

  const now = Date.now();
  const maxAgeMs = options.maxAgeMs || 30000;
  if (Math.abs(now - timestamp) > maxAgeMs) {
    return false; // Expired signature window
  }

  const payloadDigest = crypto
    .createHash('sha256')
    .update(typeof resultPayload === 'string' ? resultPayload : JSON.stringify(resultPayload))
    .digest('hex');

  const jobId = options.jobId || 'job';
  const raw = `${jobId}:${timestamp}:${nonce}:${payloadDigest}`;
  const expectedSignature = crypto.createHmac('sha256', secret).update(raw).digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expectedSignature, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Validates runner response schema.
 */
function validateRunnerResponse(data) {
  if (!data || typeof data !== 'object') return false;
  const { stdout, stderr, exitCode, output } = data;
  const isStringOrNull = (val) => typeof val === 'string' || val === null || val === undefined;
  const isInt = typeof exitCode === 'number';
  return isInt && isStringOrNull(stdout) && isStringOrNull(stderr) && isStringOrNull(output);
}

/**
 * Circuit Breaker States
 */
const CIRCUIT_STATE = Object.freeze({
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN',
});

/**
 * Execution Gateway with fail-closed posture, HMAC signature validation, and HALF_OPEN circuit breaker recovery.
 */
function createExecutionGateway(options = {}) {
  const isProduction = options.isProduction ?? (process.env.NODE_ENV === 'production');
  const hmacSecret = validateSecret(options.hmacSecret || process.env.RUNNER_HMAC_SECRET, isProduction);
  const runnerUrl = options.runnerUrl || process.env.PISTON_RUNNER_URL || null;
  const pistonProtocol = Boolean(runnerUrl && /\/api\/v2\/execute\/?$/i.test(runnerUrl));
  const cooldownMs = options.cooldownMs || 10000;
  const failureThreshold = options.failureThreshold || 3;

  let state = CIRCUIT_STATE.CLOSED;
  let consecutiveFailures = 0;
  let nextAttemptAllowedAt = 0;
  const processedNonces = new Set();

  async function executeJob(language, code, stdin = '', timeoutMs = 5000, jobOptions = {}) {
    const now = Date.now();

    // Circuit Breaker State Check
    if (state === CIRCUIT_STATE.OPEN) {
      if (now >= nextAttemptAllowedAt) {
        state = CIRCUIT_STATE.HALF_OPEN;
      } else {
        const err = new Error('Runner service is currently unavailable');
        err.code = 'runner_unavailable';
        err.status = 503;
        throw err;
      }
    }

    if (!runnerUrl) {
      consecutiveFailures++;
      if (consecutiveFailures >= failureThreshold || state === CIRCUIT_STATE.HALF_OPEN) {
        state = CIRCUIT_STATE.OPEN;
        nextAttemptAllowedAt = Date.now() + cooldownMs;
      }
      const err = new Error('Runner service is not configured');
      err.code = 'runner_unavailable';
      err.status = 503;
      throw err;
    }

    const normalizedLanguage = PISTON_LANGUAGE_MAP[language] || language;
    const payload = pistonProtocol
      ? {
          language: normalizedLanguage,
          version: '*',
          files: [{ name: normalizedLanguage === 'rscript' ? 'script.R' : 'main', content: code }],
          stdin,
          run_timeout: timeoutMs,
        }
      : { language: normalizedLanguage, code, stdin, timeoutMs };
    const jobId = jobOptions.jobId || crypto.randomUUID();
    const signed = signJobPayload(payload, hmacSecret, { jobId });

    // Nonce replay protection
    if (processedNonces.has(signed.nonce)) {
      const err = new Error('Duplicate execution request nonce');
      err.code = 'replay_detected';
      err.status = 400;
      throw err;
    }
    processedNonces.add(signed.nonce);
    if (processedNonces.size > 10000) {
      const first = processedNonces.values().next().value;
      processedNonces.delete(first);
    }

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs + 2000);

    try {
      const signals = [controller.signal, jobOptions.signal].filter(Boolean);
      const requestSignal =
        signals.length > 1 && typeof AbortSignal.any === 'function'
          ? AbortSignal.any(signals)
          : signals[signals.length - 1];
      const response = await fetch(pistonProtocol ? runnerUrl : `${runnerUrl.replace(/\/$/, '')}/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Runner-Job-Id': jobId,
          'X-Runner-Signature': signed.signature,
          'X-Runner-Timestamp': String(signed.timestamp),
          'X-Runner-Nonce': signed.nonce,
          'X-Runner-Expiry': String(signed.expiry),
          'X-Runner-Digest': signed.payloadDigest,
        },
        body: JSON.stringify(payload),
        signal: requestSignal,
      });

      clearTimeout(timeoutHandle);

      if (!response.ok) {
        throw new Error(`Upstream runner failed with status ${response.status}`);
      }

      const responseSignature = response.headers.get('x-runner-signature');
      const responseTimestamp = Number.parseInt(response.headers.get('x-runner-timestamp') || '0', 10);
      const responseNonce = response.headers.get('x-runner-nonce');

      const rawText = await response.text();
      if (rawText.length > 1024 * 1024) {
        throw new Error('Runner response size limit exceeded');
      }

      const parsedResult = JSON.parse(rawText);
      const result = pistonProtocol
        ? {
            stdout: parsedResult.run?.stdout || '',
            stderr: parsedResult.run?.stderr || parsedResult.compile?.stderr || '',
            exitCode: parsedResult.run?.code ?? parsedResult.compile?.code ?? 1,
            output: parsedResult.run?.output || parsedResult.compile?.output || '',
          }
        : parsedResult;

      // Verify HMAC signature if signature header is provided or required
      if (!pistonProtocol && (responseSignature || isProduction)) {
        const isValid = verifyResultSignature(result, responseSignature, responseTimestamp, responseNonce, hmacSecret, { jobId });
        if (!isValid) {
          const err = new Error('Runner response signature verification failed');
          err.code = 'invalid_runner_signature';
          err.status = 502;
          throw err;
        }
      }

      if (!validateRunnerResponse(result)) {
        throw new Error('Runner response failed schema validation');
      }

      // Success -> Reset Circuit Breaker
      state = CIRCUIT_STATE.CLOSED;
      consecutiveFailures = 0;

      return result;
    } catch (err) {
      clearTimeout(timeoutHandle);
      consecutiveFailures++;

      if (consecutiveFailures >= failureThreshold || state === CIRCUIT_STATE.HALF_OPEN) {
        state = CIRCUIT_STATE.OPEN;
        nextAttemptAllowedAt = Date.now() + cooldownMs;
      }

      if (err.name === 'AbortError') {
        const timeoutErr = new Error('Runner execution request timed out');
        timeoutErr.code = 'execution_timeout';
        timeoutErr.status = 504;
        throw timeoutErr;
      }

      const error = new Error('Runner execution failed');
      error.code = err.code || 'runner_unavailable';
      error.status = err.status || 503;
      error.cause = err;
      throw error;
    }
  }

  function resetCircuitBreaker() {
    state = CIRCUIT_STATE.CLOSED;
    consecutiveFailures = 0;
    nextAttemptAllowedAt = 0;
  }

  return {
    executeJob,
    signJobPayload: (p, opts) => signJobPayload(p, hmacSecret, opts),
    verifyResultSignature: (res, sig, ts, nonce, opts) => verifyResultSignature(res, sig, ts, nonce, hmacSecret, opts),
    getCircuitState: () => state,
    isCircuitOpen: () => state === CIRCUIT_STATE.OPEN,
    resetCircuitBreaker,
  };
}

module.exports = {
  signJobPayload,
  verifyResultSignature,
  validateRunnerResponse,
  createExecutionGateway,
  CIRCUIT_STATE,
};
