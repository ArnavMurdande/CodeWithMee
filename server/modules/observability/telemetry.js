'use strict';

const { randomBytes } = require('node:crypto');

const TRACEPARENT_PATTERN = /^00-([a-f0-9]{32})-([a-f0-9]{16})-(0[01])$/;
const MAX_METRIC_KEYS = 200;

function randomHex(bytes) {
  return randomBytes(bytes).toString('hex');
}

function traceContext(traceparent, idFactory = randomHex) {
  const match = typeof traceparent === 'string' ? traceparent.match(TRACEPARENT_PATTERN) : null;
  const validParent = match && !/^0+$/.test(match[1]) && !/^0+$/.test(match[2]);
  const traceId = validParent ? match[1] : idFactory(16);
  const spanId = idFactory(8);
  return Object.freeze({
    spanId,
    traceId,
    traceparent: `00-${traceId}-${spanId}-01`,
  });
}

function boundedLabel(value, fallback = 'unknown') {
  const normalized = String(value || fallback).toLowerCase();
  return /^[a-z0-9_.:-]{1,80}$/.test(normalized) ? normalized : fallback;
}

function createTelemetry({ clock = () => new Date(), logger, service = 'codewithmee-api' } = {}) {
  const counters = new Map();

  function increment(name, labels = {}, amount = 1) {
    const normalizedLabels = Object.entries(labels)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${boundedLabel(key)}=${boundedLabel(value)}`)
      .join(',');
    const key = `${boundedLabel(name)}{${normalizedLabels}}`;
    if (!counters.has(key) && counters.size >= MAX_METRIC_KEYS) {
      counters.set(
        'telemetry_dropped_metric_keys_total{}',
        1 + (counters.get('telemetry_dropped_metric_keys_total{}') || 0),
      );
      return;
    }
    counters.set(key, (counters.get(key) || 0) + amount);
  }

  return Object.freeze({
    recordError({ code, status }) {
      increment('http_errors_total', { code, status });
    },
    recordJob(summary) {
      increment('jobs_claimed_total', {}, summary.claimed);
      increment('jobs_completed_total', {}, summary.completed);
      increment('jobs_failed_total', {}, summary.failed);
      increment('jobs_retried_total', {}, summary.retried);
    },
    recordRequest({ durationMs, method, status }) {
      increment('http_requests_total', { method, status });
      increment('http_request_duration_ms_total', { method }, durationMs);
    },
    snapshot() {
      return Object.freeze({
        capturedAt: clock().toISOString(),
        counters: Object.freeze(Object.fromEntries([...counters.entries()].sort())),
        service,
      });
    },
    startSpan(name, attributes = {}) {
      const startedAt = clock();
      const context = traceContext(null);
      return Object.freeze({
        context,
        end(status = 'ok') {
          const durationMs = Math.max(0, clock().getTime() - startedAt.getTime());
          logger?.info?.('telemetry_span_completed', {
            attributes,
            durationMs,
            name: boundedLabel(name),
            spanId: context.spanId,
            status: boundedLabel(status),
            traceId: context.traceId,
          });
        },
      });
    },
  });
}

function createDisabledErrorReporter() {
  return Object.freeze({
    capture() {},
    configured: false,
  });
}

module.exports = {
  MAX_METRIC_KEYS,
  TRACEPARENT_PATTERN,
  createDisabledErrorReporter,
  createTelemetry,
  traceContext,
};
