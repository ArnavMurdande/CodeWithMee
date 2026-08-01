'use strict';

const { createHash } = require('node:crypto');

function stableValue(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter(
        (key) =>
          !key.endsWith('Id') &&
          !key.endsWith('Ids') &&
          ![
            'activeKey',
            'createdAt',
            'currentTokenHash',
            'csrfTokenHash',
            'id',
            'ipHash',
            'passwordHash',
            'tokenHash',
            'updatedAt',
          ].includes(key),
      )
      .map((key) => [key, stableValue(value[key])]),
  );
}

function fingerprint(value) {
  return createHash('sha256')
    .update(JSON.stringify(stableValue(value)))
    .digest('hex');
}

function createShadowReadRepository({ domain, logger = console, methods, primary, secondary }) {
  const pending = new Set();
  const repository = { ...primary };
  for (const method of methods) {
    if (typeof primary[method] !== 'function' || typeof secondary[method] !== 'function') {
      throw new Error(`Shadow method ${domain}.${method} is unavailable.`);
    }
    repository[method] = async (...args) => {
      const primaryResult = await primary[method](...args);
      const comparison = Promise.resolve()
        .then(() => secondary[method](...args))
        .then((secondaryResult) => {
          const matched = fingerprint(primaryResult) === fingerprint(secondaryResult);
          logger.info('persistence_shadow_comparison', {
            code: matched ? 'shadow_match' : 'shadow_mismatch',
            domain,
            method,
          });
        })
        .catch(() => {
          logger.warn('persistence_shadow_unavailable', {
            code: 'shadow_unavailable',
            domain,
            method,
          });
        })
        .finally(() => pending.delete(comparison));
      pending.add(comparison);
      return primaryResult;
    };
  }
  repository.$drainShadowReads = () => Promise.allSettled([...pending]);
  return Object.freeze(repository);
}

module.exports = { createShadowReadRepository, fingerprint, stableValue };
