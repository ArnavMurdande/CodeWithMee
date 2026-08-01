# ADR 0002: Single-store persistence cutover authority

- **Status:** Accepted
- **Date:** 2026-08-01
- **Roadmap:** `P0C-S5`

## Context

CodeWithMee currently has replaceable identity, organization and authority services, but most legacy feature routes access Mongoose models directly. Imported PostgreSQL users use deterministic UUIDs while Mongo documents use ObjectIds. Switching identity alone would therefore issue principals that legacy feature routes cannot resolve. Ad hoc dual writes would add divergent failure ordering to credentials, roles, enrollments and social state.

## Decision

Each persistence domain has exactly one response/write authority. Identity, organizations and authority form one atomic cutover unit. They may switch to their complete parameterized PostgreSQL repositories only when the direct legacy API is disabled. Learning, challenges, courses, social, ideas and integrations fail configuration if selected for PostgreSQL before their route/service repository boundary is complete.

Cutover requires an HMAC-authenticated aggregate parity report, an immutable rollback-snapshot checksum, a future retention deadline, a rehearsed rollback and a write freeze. Activation uses two matching controls:

1. explicit deployment environment values; and
2. PostgreSQL `feature_flags` records written by the guarded operator command.

The server refuses startup if store, generation, dataset, report, snapshot or deadline differs. Shadow reads are metadata-only, limited to natural-key repository methods and never affect the primary response. They strip identifiers, timestamps and secrets before hashing and log no arguments or values. Rollback changes the database record first under a new freeze, then redeploys all members of the cutover unit to Mongoose and revokes cutover-window sessions.

## Consequences

- No request is dual-written and no database edit alone can change runtime authority.
- Core `/api/v1` identity/organization/authority can be rehearsed independently while unsafe legacy endpoints return a deliberate 410.
- Feature-domain PostgreSQL cutovers wait for their owning modular service work instead of inheriting mixed ObjectId/UUID behavior.
- Activation has a short maintenance window and requires disciplined source retention; it is unavailable when parity has quarantines or the rollback deadline has expired.
- A live migration still requires external credentials, operator approval, backups and deployment evidence. Local fixture activation/rollback does not claim production cutover.
