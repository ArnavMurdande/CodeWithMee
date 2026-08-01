# P0F-S5 observability evidence

Date: 2026-08-01  
Status: verified local instrumentation; external exporter/monitoring activation deferred to Phase 6

## Objective and reuse

Add OpenTelemetry-compatible request correlation, bounded request/job/error metrics, safe error-reporting seams and executable synthetic health checks without adding a vendor or leaking user data. This reuses P0D structured redacted logs, request IDs, aggregate/detail health probes and the durable outbox worker.

## Implemented changes

- `server/modules/observability/telemetry.js` accepts valid W3C `traceparent`, creates child trace/span identifiers, returns a response trace header, records bounded low-cardinality counters, exposes an in-process snapshot and provides a structured span completion hook.
- HTTP completion/failure logs now carry trace/span correlation. Request duration/status and normalized public error code metrics are recorded; raw URL, query, body, user, IP, token, error message and stack are excluded.
- Error reporting is an injected adapter receiving only code, error name, route template, status, request ID and trace ID. The default is disabled and reporter failure cannot break the HTTP response.
- The outbox worker accepts the same telemetry interface and records claimed/completed/retried/failed totals after each batch.
- `health:synthetic` checks public live/ready endpoints with a three-second bound, refuses credentials/query/fragment and requires HTTPS except for loopback.

No database, API schema, frontend or deployment change was required. Metrics remain process-local and reset on restart; there is no claim of durable production telemetry.

## Verification and security

Four new server tests cover parent/child trace consistency, metric cardinality bounds, HTTP trace/error metadata, safe URL policy and both synthetic endpoints. Server total is 162. Existing structured-log redaction remains the final sink, and metric labels are limited to method/status/normalized code rather than user/resource identifiers.

The safe fallback is structured logs plus public aggregate health with the error reporter disabled. Phase 6 must configure an authenticated OTLP/error provider, sampling, retention, dashboards, alerts, source-map/PII review and an external scheduled synthetic monitor. Failure or absence of those services must remain visible; telemetry must never become a request dependency.

## Definition of completion

P0F-S5 is complete when request and job paths emit correlated bounded signals, unknown errors can reach an injected metadata-only reporter without affecting responses, live/ready are synthetically testable, redaction/cardinality are regression-tested and no provider is falsely claimed. These conditions pass locally.
