'use strict';

const REDACTED = '[REDACTED]';
const SENSITIVE_KEY =
  /(?:authorization|cookie|csrf|email|ip(?:address)?|password|secret|token|useragent)/i;

function sanitizeValue(value, key = '', seen = new WeakSet()) {
  if (SENSITIVE_KEY.test(key)) return REDACTED;
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.slice(0, 500);
  if (value instanceof Error) {
    return Object.freeze({
      code: String(value.code || 'internal_error').slice(0, 100),
      name: value.name,
    });
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeValue(item, key, seen));
  if (typeof value !== 'object') return String(value).slice(0, 500);
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  const output = {};
  for (const [childKey, childValue] of Object.entries(value).slice(0, 100)) {
    output[childKey] = sanitizeValue(childValue, childKey, seen);
  }
  return output;
}

function createStructuredLogger({
  clock = () => new Date(),
  destination = console,
  environment = 'development',
  service = 'codewithmee-api',
} = {}) {
  function emit(level, event, fields = {}) {
    const sanitized = sanitizeValue(fields);
    const metadata =
      sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)
        ? sanitized
        : { message: sanitized };
    const record = {
      environment,
      event,
      level,
      service,
      timestamp: clock().toISOString(),
      ...metadata,
    };
    const writer = destination[level] || destination.log || (() => undefined);
    writer.call(destination, JSON.stringify(record));
    return Object.freeze(record);
  }
  return Object.freeze({
    error: (event, fields) => emit('error', event, fields),
    info: (event, fields) => emit('info', event, fields),
    structured: true,
    warn: (event, fields) => emit('warn', event, fields),
  });
}

function asStructuredLogger(logger, options = {}) {
  if (logger?.structured === true) return logger;
  const wrapped = createStructuredLogger({ destination: logger || console, ...options });
  return Object.freeze({ ...wrapped, structured: true });
}

module.exports = { REDACTED, asStructuredLogger, createStructuredLogger, sanitizeValue };
