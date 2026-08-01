'use strict';

function withTimeout(operation, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    Promise.resolve()
      .then(operation)
      .then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        () => {
          clearTimeout(timer);
          resolve(false);
        },
      );
  });
}

function createReadinessProbe({ checks = [], timeoutMs = 1_500 } = {}) {
  const definitions = checks.map((check) =>
    Object.freeze({ name: check.name, probe: check.probe, required: check.required !== false }),
  );
  return async function readinessProbe() {
    const outcomes = await Promise.all(
      definitions.map(async (check) => {
        const available = (await withTimeout(check.probe, timeoutMs)) === true;
        return Object.freeze({
          name: check.name,
          status: available ? 'ok' : check.required ? 'unavailable' : 'optional_unavailable',
        });
      }),
    );
    return Object.freeze({
      checks: Object.freeze(outcomes),
      ready: outcomes.every((outcome) => outcome.status !== 'unavailable'),
    });
  };
}

module.exports = { createReadinessProbe, withTimeout };
