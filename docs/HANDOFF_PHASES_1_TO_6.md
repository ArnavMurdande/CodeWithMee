# CodeWithMee Phase 1–6 implementation handoff

Use `docs/IMPLEMENTATION_PLAN.md` as the normative 15-field specification and `docs/IMPLEMENTATION_PROGRESS.md` as the only status ledger. This file is the file-by-file execution map for the next coding agent.

## Mandatory implementation loop

For every stable item ID: read its full subphase in `IMPLEMENTATION_PLAN.md`; keep PostgreSQL/UUID/current-principal/OpenAPI/outbox/file-service contracts; add an immutable migration only when needed; implement repository → service → policy → router → UI; update OpenAPI and security coverage; add unit/integration/browser tests; run `npm run check`, relevant database E2E and browser E2E; update decisions, migration log, test results, known limits and the tracker. Never mark a live provider/deployment verified from a fake.

## Phase 1 — core learning and challenges

| Order/IDs | Deliverable | Create | Edit and verify |
| --- | --- | --- | --- |
| 1A `P1A-S1..S6` | Versioned challenge/tag/starter/visible-hidden test authoring, publish flow, responsive catalog/solver and reviewed seed set. Learner DTO must never contain hidden cases/solution. | `server/modules/challenges/{contracts,repository,service,policy,router}.js`, `client/src/features/challenges/**`, new migration and seed fixture. | `prisma/schema.prisma`, migration manifest, API operations/contracts/security coverage, `App.js`, Challenges/Solver/CreateChallenge pages; DTO/IDOR/seed/accessibility tests. |
| 1B `P1B-S1..S6` | Private signed execution gateway, durable jobs/quotas/timeouts, Run visible cases, Submit hidden immutable suite, history/detail and abuse/capacity gates. | `server/modules/execution/**`, runner agent under `services/runner-agent/**`, execution migration, client execution feature/tests. | outbox/telemetry/rate limits, challenge service/API, solver UI, deployment/security plans. Never execute learner code in API process. |
| 1C `P1C-S1..S6` | Versioned first-party course tree, video interval/resume sync, derived lesson/module/course progress, challenge completion events and cross-device UI. | `server/modules/learning/**`, progress migration/reconciliation job, `client/src/features/learning/**`. | course models/adapters, outbox, API/OpenAPI, Courses/Pathways/Dashboard; revision/conflict/offline/replay tests. |

## Phase 2 — provider LMS

| Order/IDs | Deliverable | Create | Edit and verify |
| --- | --- | --- | --- |
| 2A `P2A-S1..S5` | Organization/course roles, provider approval/suspension, invitations, dashboard and staff management. | `server/modules/provider/**`, `client/src/features/provider/{dashboard,staff}/**`. | organization/authority services, admin page, OpenAPI/security matrix; tenant-IDOR and invitation lifecycle tests. |
| 2B `P2B-S1..S5` | Draft/versioned courses, module/lesson builder, video/external links, notes/resources/download policy, publish/retire/version migration. | `server/modules/courses/**`, course-content migration, `client/src/features/course-authoring/**`. | file service, URL/restricted content, Courses route, APIs; ordering/conflict/private-entitlement/media tests. |
| 2C `P2C-S1..S5` | Versioned quizzes/written answers/assignments, ZIP/file submissions, grading/rubrics/feedback/regrade. | `server/modules/assessments/**`, assessment migration, `client/src/features/assessments/**`. | files/outbox/course progress/API; hidden-key, archive bomb/MIME, grading race and a11y tests. Never execute submitted ZIPs. |
| 2D `P2D-S1..S5` | Private invites/enrollment state, QR payment order/proof, permissioned manual decision, entitlement grant and notifications. | `server/modules/enrollments/**`, payment migration, `client/src/features/enrollment/**`, payment-review runbook. | organizations/files/outbox/email/API; idempotency, double approval, expiry, dispute and audit tests. No automatic payment claim. |
| 2E `P2E-S1..S5` | Versioned learning events, outbox aggregates/rebuild, learner/course analytics, audited CSV export and reconciliation/load tests. | `server/modules/analytics/**`, analytics migration/jobs, `client/src/features/analytics/**`. | learning/assessment producers, outbox, provider dashboard; tenant isolation, freshness, deletion and representative-volume tests. |

## Phase 3 — The Space

| Order/IDs | Deliverable | Create | Edit and verify |
| --- | --- | --- | --- |
| 3A `P3A-S1..S5` | Minimal public profile DTO/privacy, follows plus explicit friend requests, symmetric block cleanup and relationship UI. | `server/modules/social/relationships/**`, social migration, `client/src/features/social/profiles/**`. | identity policy, Space/Profile, API; race/IDOR/block/privacy/mobile tests. |
| 3B `P3B-S1..S5` | Posts, text/scanned images, bounded comments/replies/reactions/saves, cursor feed; external-video embeds first. | `server/modules/social/content/**`, feed queries, `client/src/features/social/feed/**`. | file/moderation/URL/outbox/API; N+1/load/a11y/privacy tests. Native video stays paid-capacity gated. |
| 3C `P3C-S1..S5` | Daily challenge events, timezone streak snapshots/rebuild, opt-in friend comparison, notifications and immutable credit/award ledger. | `server/modules/social/{streaks,notifications,credits}/**`, migrations/jobs, client widgets/inbox. | challenge/outbox/preferences; replay/timezone/abuse/reversal/privacy tests. Credits are non-cash/non-transferable. |
| 3D `P3D-S1..S5` | Reporting taxonomy, moderation cases/actions/appeals and cross-module enforcement. | `server/modules/moderation/**`, migration, `client/src/features/moderation/**`, community/moderator runbooks. | feed/files/notifications/ideas/security; evidence retention, audit, block, appeal and enforcement matrix. Public UGC waits for named moderators. |

## Phase 4 — Creative Space

| Order/IDs | Deliverable | Create | Edit and verify |
| --- | --- | --- | --- |
| 4A `P4A-S1..S5` | Idea lifecycle/visibility, owner-editor-commenter-viewer collaborators, invites and private/friends/public policy/UI. | `server/modules/ideas/core/**`, idea migration, `client/src/features/ideas/**`. | social block/moderation, API/App; collaborator races, ownership, privacy and mobile tests. |
| 4B `P4B-S1..S5` | Notes/links/files, comments, structured suggestions/votes, update history, repo/demo links and prototype submissions. | `server/modules/ideas/artifacts/**`, migrations, idea detail/editor components. | files/restricted content/URL/outbox/moderation; nested authorization, hostile input, vote uniqueness/history tests. Never execute prototypes. |
| 4C `P4C-S1..S5` | Versioned AI blueprint schema, authorized/redacted context, queued provider, validation/repair/version UI and human-review gates. | `server/modules/blueprints/**`, blueprint migration, `client/src/features/blueprints/**`. | AI adapter/outbox/telemetry/rate limits/ideas/API; prompt injection, leak, quota, schema/provider failure tests. Deterministic templates are fallback. |

## Phase 5 — browser IDE and extension

| Order/IDs | Deliverable | Create | Edit and verify |
| --- | --- | --- | --- |
| 5A `P5A-S1..S5` | Practice task/starter manifests, safe virtual paths, self-hosted Monaco multi-model editor/file tree/instructions/output and responsive layouts. | `server/modules/workspaces/contracts.js`, `client/src/features/ide/**`, self-hosted Monaco asset config. | current CodeEditor/Sandbox, CSP/build budgets/API; path traversal, keyboard, mobile and performance tests. |
| 5B `P5B-S1..S5` | Saved workspace revisions/autosave/conflicts, recoverable reset/history, secure validation and progress sync. | workspace migration/repository/service/jobs, `client/src/features/workspaces/**`. | execution gateway/learning/outbox/API; concurrency, reset, quota, cross-device and runner-redaction E2E. |
| 5C `P5C-S1..S6` | VS Code extension, PKCE/device-safe auth, idea/blueprint retrieval, starter generation preview/apply/rollback and progress sync. | `extension/{package.json,src,test}/**`, shared generated API client, VSIX workflow. | auth scopes/OpenAPI/blueprints/workspaces; Workspace Trust, SecretStorage, symlink/path/protected-file/no-overwrite property tests. Publish only after owner approval. |

## Phase 6 — deployment and production hardening

| Order/IDs | Deliverable | Create | Edit and verify |
| --- | --- | --- | --- |
| 6A `P6A-S1..S5` | Reproducible web/API/worker containers, managed PostgreSQL migration job, private object/CDN, API/worker network and isolated runner/email/jobs. | `Dockerfile.web`, `Dockerfile.api`, `Dockerfile.worker`, `compose.yml`, `infra/**`, deploy runbooks. | runtime env/health/storage/execution/email; staging dependency/failure/migration smoke. Digest/non-root policy activates immediately. |
| 6B `P6B-S1..S6` | OTLP logs/traces/metrics, SLO dashboards/alerts, shared rate limits, complete CI including image CVE/SBOM/signing/provenance, backups/restore and health/synthetics. | `server/modules/observability/exporters/**`, `.github/workflows/release.yml`, monitoring/incident/restore runbooks. | P0F workflows/telemetry/deployment/security; load, alert, incident, restore and supply-chain acceptance. |
| 6C `P6C-S1..S5` | Cost triggers/upgrade order, runner sizing, formal RPO/RTO/vendor exit, penetration/privacy/legal/support/on-call and go-live decision. | capacity/cost model, threat review, go-live and incident evidence under `docs/operations/**`. | deployment/security/known limits; named-owner sign-off. No code-only completion claim. |

## Infrastructure sequence

Free/local: Vite static hosting, one small API/worker instance, free PostgreSQL/object storage/email allowances, GitHub Actions and deterministic fake providers can support development/private beta only. Paid becomes mandatory first for isolated code execution, reliable database PITR/connections, video/object egress, always-on workers/email, centralized telemetry/retention and moderation/on-call. Upgrade in this order: database/backups → private storage/CDN → API/worker → runner pool → email → monitoring/security retention.

## Never redesign these contracts

One user identity; platform/org/course roles loaded from current state; PostgreSQL as target authority; UUIDs; versioned immutable published content; learner-safe DTOs; private scanned files; outbox/idempotency for side effects; cursor pagination/revision locks; problem details; no learner code in API; no raw HTML; no production secret in client; deny by default; exact stable roadmap IDs.
