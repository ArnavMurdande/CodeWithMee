# CodeWithMee Tooling Contract

Phase 0A keeps the independent `client/` and `server/` applications active. Root commands orchestrate their existing lockfiles without npm workspace hoisting, so this slice does not silently change dependency resolution while the working tree contains user changes.

## Supported runtime

- Node.js `24.x`; the repository is pinned to `24.18.0` in `.nvmrc` and `.node-version`.
- npm `11.x`; the recorded package manager is `npm@11.5.2`.
- `.npmrc` enforces the Node/npm engine contract and exact versions for future saved dependencies.

The pin follows the active Node 24 LTS line. A runtime-major change requires compatibility evidence and a decision-record update.

## Root commands

| Command                 | Purpose                                                                        | Current boundary                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run preflight`     | Reject unsupported Node/npm majors.                                            | No service or secret access.                                                                                                                         |
| `npm run install:all`   | Run deterministic `npm ci` for root, client and server lockfiles.              | Does not consolidate or delete independent lockfiles.                                                                                                |
| `npm run dev:client`    | Start the Vite client.                                                         | Local `/api` and `/uploads` requests use the configured Vite proxy.                                                                                  |
| `npm run dev:server`    | Start the current nodemon server.                                              | Requires the existing server environment.                                                                                                            |
| `npm run build`         | Verify runtime, build the Vite client and syntax-check server JavaScript.      | No CRA artifact or fallback builder remains.                                                                                                         |
| `npm run lint`          | Run root ESLint 10 over client JavaScript, server and tooling.                 | Existing warnings are preserved; React-aware lint rules return with the Phase 0F test/lint foundation.                                               |
| `npm run typecheck`     | Strictly check root tooling and the typed Vite client surface.                 | Existing application JavaScript is resolved but is not falsely represented as `checkJs`-verified TypeScript.                                         |
| `npm run test`          | Run tooling tests, server tests, then the explicit missing-client-runner gate. | Tooling and server suites must pass first; the aggregate intentionally exits 1 until Phase 0F installs and exercises a Vite-compatible client suite. |
| `npm run format:check`  | Check only the inspected root tooling surface.                                 | Existing application source is not mass-formatted over user changes.                                                                                 |
| `npm run check:tooling` | Verify the complete new tooling slice.                                         | This is the acceptance command for the current slice.                                                                                                |
| `npm run check`         | Run the broad repository gate.                                                 | Expected to fail until known legacy lint/test debt is resolved.                                                                                      |

## Formatting and linting ownership

- `.editorconfig` defines repository text conventions.
- `.prettierrc.json` is the shared formatter policy.
- `eslint.config.mjs` checks client JavaScript, server and tooling through root ESLint 10. Existing client debt is warning-only during the incremental conversion; React-specific hook rules are not yet restored.
- The formatting command intentionally targets only clean/new Phase 0 tooling files. Each later vertical slice expands formatting coverage only after inspecting the files it owns.

## Vite client architecture

- `client/index.html`, `client/src/main.tsx`, `client/vite.config.mts` and `client/tsconfig.vite.json` are the active Vite/TypeScript entry surface.
- Existing JSX-bearing `.js` modules remain byte-preserved. A small pre-transform uses Vite 8's Oxc transformer so those modules can migrate one inspected file at a time.
- `@vitejs/plugin-react` 5.2 remains paired with Vite 8. An attempted plugin 6 lock refresh encountered its optional Babel peer conflict; there is no functional or security reason to force it.
- `tsconfig.vite.json` is the client TypeScript contract. `runtime.ts` and `api.ts` are native typed modules; JSX-bearing `.js` files migrate one inspected slice at a time.
- CRA, react-app-rewired, the Prism Babel override, legacy scripts and duplicate entry/template files were removed only after Vite route/build parity and configuration parity passed.
- Vite output is `client/dist/` and is ignored.

## Install and rollback

`npm run install:all` recreates dependency folders from the three committed lockfiles without changing application code or source data. Rollback is source-control based: restore the reviewed manifests, locks and configuration together; there is no second client toolchain to drift or patch.

## Public client configuration

Copy public settings from `client/.env.example`; never place server secrets in `VITE_` variables because those values are shipped to browsers.

| Canonical Vite variable     | Purpose                                                      | Default/fallback                                             |
| --------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ |
| `VITE_API_BASE_URL`         | Optional absolute API origin for split frontend/API hosting. | Empty: same-origin `/api` and `/uploads`.                    |
| `VITE_API_TIMEOUT_MS`       | Axios timeout from 1,000 through 120,000 milliseconds.       | 20,000 milliseconds.                                         |
| `VITE_DEV_API_PROXY_TARGET` | Local-only Vite proxy for `/api` and `/uploads`.             | `http://127.0.0.1:5001`; not embedded in the browser bundle. |

`client/src/config/runtime.ts` validates the typed schema, and `client/src/lib/api.ts` is the only direct Axios boundary. Production may use either a same-origin edge proxy or `VITE_API_BASE_URL=https://api.example`; paths, embedded credentials, non-HTTP schemes, queries and fragments are rejected.

## Server lifecycle and configuration

- `server/app.js` constructs the Express application and mounts routes. Importing it does not read secrets, connect to MongoDB, change DNS servers or open a network listener.
- `server/config/runtime.js` validates host, port, exact CORS origins, optional MongoDB URI, DNS server addresses and the Piston execution URL. `server/.env.example` contains names and placeholders only.
- `server/database.js` owns MongoDB connection/disconnection. Missing or unavailable MongoDB remains an explicit local-development degraded mode until Phase 0C supplies the authoritative PostgreSQL store.
- `server/start.js` composes validated configuration, DNS, database and HTTP startup and exposes an injectable closeable lifecycle for tests.
- `server/index.js` is the thin executable entry: it loads `.env`, starts the service, and handles `SIGINT`/`SIGTERM` without duplicating construction logic.
- Piston defaults to `http://127.0.0.1:2000/api/v2/execute` and is overridable through `PISTON_API_URL`; application routes do not embed runner origins.

`npm run dev:server` starts the backend with nodemon. `npm run test:server` uses Node's built-in runner, an ephemeral port and injected configuration; it does not require MongoDB, provider keys or Piston. Production health/readiness, request draining and fail-closed dependency policy remain Phase 6 work.

## Unified identity development boundary

The new identity surface is mounted under `/api/v1` alongside the time-limited legacy routes:

- `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/logout-all`;
- `/auth/email/verify/request`, `/auth/email/verify/confirm`;
- `/auth/password/forgot`, `/auth/password/reset`;
- `/auth/google/start`, `/auth/google/callback`;
- `/me` and `/me/sessions`.

The same composed `/api/v1` module now exposes the P0B-S3 organization boundary:

- `/organizations` and `/organizations/:organizationId`;
- `/organizations/:organizationId/members` and member lifecycle routes;
- `/organizations/:organizationId/invitations` and `/organization-invitations/:token/accept`;
- `/organizations/:organizationId/verification`;
- `/admin/provider-verifications` and its decision route.

Organization tests reuse the in-memory identity principal, repository and capture mailer, including real ephemeral HTTP requests. The production adapter uses separate compatibility organization collections only when the same database/secrets gate enables unified identity. No invitation token is returned by HTTP or logged.

It is enabled only when MongoDB is connected and both the explicit `ACCESS_TOKEN_SECRET` and `REFRESH_TOKEN_PEPPER` contain at least 32 bytes. `JWT_SECRET` is not an alias. Production also requires an HTTPS web origin and secure cookies. Partial or weak configuration fails closed; app construction still has no database/listener side effects.

Server tests use an in-memory repository and capture mailer behind the same service contract. The runtime adapter uses compatibility Mongoose collections until Phase 0C replaces only the repository with Prisma/PostgreSQL. Google verification is tested with an injected signed-claim verifier; live JWKS/code exchange and transactional email remain external activation checks. Verification/reset/refresh values are never logged.

`PASSWORD_COMPROMISE_CHECK_MODE` defaults to `local` outside production and `required` in production. Required mode calls the free Pwned Passwords range endpoint with only the five-character SHA-1 prefix and `Add-Padding: true`; provider failure returns `503` before a password is stored. `best_effort` retains the local denylist during provider failure and must be treated as an explicit security/availability tradeoff.

## Legacy authorization cutover

All still-protected unversioned feature handlers use `Authorization: Bearer <access-token>` and the current identity service. The former `/api/auth` credential surface and Company-backed provider write surface return `410` replacement responses. The `x-auth-token` parser, local recovery principal, `LEGACY_AUTH_COMPATIBILITY` configuration and `JWT_SECRET` alias have been deleted; old tokens require a fresh sign-in and cannot be re-enabled by configuration.

## Web session boundary

- `client/src/lib/auth-session.ts` is the only access-token store and retains the short-lived value in module memory only.
- `client/src/lib/api.ts` is the only direct Axios import. It attaches the Bearer token, mirrors the readable `cwm_csrf` cookie on unsafe requests, sends credentials, and shares one refresh promise across concurrent 401 responses.
- `AuthContext` cold-starts through `/api/v1/auth/refresh`, broadcasts session availability/sign-out across tabs, and exposes verification, reset and owner-scoped session operations.
- Google sign-in redirects to the server authorization-code start route. The browser token SDK and `VITE_` Google identifier were removed; OAuth client credentials belong only to server configuration.
- `scripts/tests/client-auth-boundary.test.mjs` recursively rejects persistent auth tokens, legacy auth headers/endpoints and direct Axios bypasses.

## Test foundation

- `npm run test` runs repository contracts, the Node server/API suite and the Vitest client component suite; any non-zero layer fails the aggregate.
- `npm run test:client` uses exact Vitest/jsdom versions and the same `sourceJavaScriptAsJsx` Oxc transform as Vite. `test:watch` is local-only; CI always uses the bounded run command.
- `client/src/test/setup.js` supplies deterministic media queries, automatic cleanup and a throwing global `fetch`; tests must inject responses rather than contact localhost or a provider.
- `server/test/support/factories.js` provides fixed clocks/sequences and domain factories. `external-fakes.js` provides fail-closed AI/video/email/private-storage/runner seams.
- Component tests cover async state, portal/menu keyboard behavior and modal focus restoration. Full-browser route/layout/axe coverage remains P0F-S3.

## Protected browser tests

- `npm run test:e2e:install` installs the pinned Chromium binary; `npm run test:e2e` first builds the production client and then runs five Playwright flows.
- The Playwright preview is fresh, loopback-only and never reused. Tests run with zero retry, blocked service workers/video and failure-only trace/screenshots.
- `e2e/p0f-smoke.spec.mjs` owns every API response. `.invalid` principals, unexpected-request `503`, external-origin failure and page-error/overflow/landmark gates prevent accidental live integration.
- WCAG 2.0/2.1 A/AA axe runs on each stable state and blocks serious/critical findings. This is automated evidence, not a screen-reader or full-conformance claim.
- Monaco's exact CDN URL is intercepted and fulfilled from installed `monaco-editor@0.56.0`; no browser-test CDN request leaves the machine. Production self-hosting remains Phase 5.

## CI, observability, and Phase 1 gate

- `npm run policy:check` enforces OpenAPI, audit, license, secret, container and workflow policies; `npm run check` includes it.
- Exceptions live only in `scripts/ci/security-policy.json` and are exact, reasoned and dated. Changed, stale or expired evidence fails.
- `quality.yml` exposes quality, Chromium and CodeQL jobs; `database.yml` owns disposable PostgreSQL. Actions/images are immutable and checkout credentials/caches are disabled.
- `npm run health:synthetic` requires `SYNTHETIC_BASE_URL`, HTTPS except loopback, and successful live plus ready JSON within three seconds.
- `npm run phase0:gate` validates all 35 prerequisite statuses and canonical evidence. It authorizes Phase 1 coding, not production launch; see `PHASE_0_RELEASE_GATE.md`.

## Privileged authority operations

`npm run bootstrap:superadmin` is a one-shot operator command, not a seed and not an HTTP route. It requires `MONGO_URI`, `SUPERADMIN_BOOTSTRAP_EMAIL`, `SUPERADMIN_BOOTSTRAP_REASON` and `SUPERADMIN_BOOTSTRAP_OPERATOR` only for that invocation. The target must already be active and email-verified, no active superadmin may exist, and the fixed operation marker must be unused. The command prints only the new audit-event and user IDs; remove the temporary environment inputs immediately afterward.

All compatibility authority writes require Mongo transaction support. A standalone local Mongo safely returns `authority_transaction_unavailable`; do not bypass it with `mongosh`/document edits. Phase 0C replaces this adapter with the same service semantics over PostgreSQL.

## PostgreSQL/Prisma baseline

- `npm run db:format`, `db:validate` and `db:generate` are schema-only gates. Prisma is pinned at `7.9.1`; generated client files are ignored build output.
- `npm run db:migrate:deploy` and `npm run db:seed` are mutation commands and fail unless `server/scripts/database-safety.js` approves the exact target. Never bypass the wrapper with a production URL.
- `npm run test:database:integration` requires `DATABASE_SAFETY_SCOPE=disposable` plus a loopback `DATABASE_ADMIN_URL` targeting the `postgres` maintenance database. It creates random `_ci` source/restore targets, applies all migrations, seeds twice, runs integration/backup recovery, and proves both exact targets absent before success.
- The committed baseline contains 25 application tables; `prisma/migration-manifest.json` protects both schema and SQL from unnoticed mechanical drift. Custom PostgreSQL constraints must remain below the generated section and receive an integration assertion.
- `.github/workflows/database.yml` repeats fresh apply, double seed and invariant tests. Local P0C-S1 evidence used a named `postgres:16.14-bookworm` container on port 55432 and confirmed both container and anonymous volume removal afterward.
- On this Windows sandbox, Prisma may need scoped access to its existing roaming engine cache after `npm ci`; that is a tooling-cache boundary, not permission to access a remote or production database.

## Read-only migration rehearsal

- `npm run migration:inventory -- --source auto --uploads server/uploads --output <exclusive-directory>` always produces an explicit unavailable-source state when no migration-specific URI exists; it never consumes `MONGO_URI`.
- `npm run migration:export -- --source mongo --output <protected-directory>` additionally requires `MIGRATION_SOURCE_MODE=read_only`, exact `MIGRATION_SOURCE_APPROVAL=read-only:<database>`, a server-disclosed read role, `MIGRATION_EXPORT_KEY` and `MIGRATION_FINGERPRINT_KEY`.
- `npm run migration:dry-run -- --snapshot <protected-directory> --output <exclusive-directory>` authenticates the snapshot and emits only `plan.ndjson` plus an operator-safe exception report. Omitting `--dry-run` remains a hard error in the source-side CLI; the separately guarded `npm run migration:import -- --apply ...` target command is the only write-capable path.
- Both keys are independent canonical base64-encoded 32-byte values. Never commit keys, snapshots, reports or temporary plaintext. Generated repository-local output belongs only under ignored `migration-output/`/`.migration-private/` and should be removed after evidence is retained safely.
- `scripts/tests/migration-pipeline.test.mjs` uses a full 18-collection fixture and disposable upload tree. P0C-S2 verification passed `check:tooling` with 27 tests and separately read/hash/stat-ed the 43 existing upload files without opening MongoDB or retaining its generated report.

## Private file lifecycle

- Leave `FILE_STORAGE_MODE` empty for an explicit unavailable API. To enable the S3-compatible adapter, set mode, DNS-compatible private bucket and region together; a custom production endpoint must be HTTPS. Credentials are optional only when the provider's default workload-identity chain is available.
- Production requires `FILE_SCANNER_MODE=external` and rejects `LOCAL_UPLOAD_SERVING=true`. Development defaults to legacy serving solely for compatibility; set it false to exercise the retirement response.
- `POST /api/v1/files/upload-intents` returns required PUT headers. Clients must send the declared length/type and base64 SHA-256 checksum exactly, then call `/complete`; completion never means ready until the scanner result is clean.
- `npm run files:cleanup` is destructive to expired object records and therefore requires `DATABASE_URL`, fully configured storage, bounded pending/quarantine hours and exact `FILE_CLEANUP_APPROVAL=cleanup:<bucket>`. Run it only from a private scheduled worker after dry operational review; it prints aggregate counts, never file names/keys.
- `server/test/file-*.test.js` uses memory/fake adapters and AWS command inspection. `server/test/database-integration.js` additionally exercises the real parameterized PostgreSQL repository after a fresh baseline migration. Neither suite calls a provider or reads legacy upload contents.

## Guarded normalized snapshot import

- Dry-run remains `npm run migration:dry-run -- --snapshot <directory> --output <exclusive-directory>`. Review every error/fatal exception and retain the plan/dataset checksums.
- Live target writing is a separate command: `npm run migration:import -- --snapshot <directory> --apply`. It never consumes `MIGRATION_SOURCE_MONGO_URI` or `MONGO_URI`.
- Set the normal database mutation scope/approval plus `MIGRATION_IMPORT_MODE=write` and `MIGRATION_IMPORT_APPROVAL=import:<database>:<full-dataset-sha256>`. Staging/production also require `MIGRATION_WRITE_FREEZE_CONFIRMED=true`. `MIGRATION_IMPORT_MAX_RECORDS` defaults to 250000 and cannot exceed 5000000.
- The command output contains only run ID, dataset/configuration/plan checksums, counts and warning codes. It does not print snapshot path, raw source IDs, emails or document content. Rerunning an already reconciled dataset/configuration returns an idempotent replay.
- `server/test/database-integration.js` exports the complete deterministic fixture to an authenticated temporary snapshot, imports it through the production writer, asserts normalization/quarantine/redaction, repeats it idempotently and removes the snapshot. CI therefore needs PostgreSQL only, not Mongo or external providers.

## Persistence parity, shadow reads, cutover and rollback

- `npm run migration:parity -- --dataset-sha256 <sha256> --output <new-private.json>` uses `PERSISTENCE_PARITY_MODE=read_only`, exact `parity:<database>:<dataset-sha256>` approval and an independent `PERSISTENCE_PARITY_KEY`. It opens a repeatable-read read-only transaction and refuses an existing, symlink or non-JSON output.
- `npm run persistence:cutover -- activate --apply --domains <sorted-domains> --report <private.json>` authenticates the report and requires every selected domain ready, exact database/report/generation approval, write freeze, rollback rehearsal, snapshot checksum/deadline and operator reference.
- `npm run persistence:cutover -- rollback --apply --domains <sorted-domains>` requires the matching active generation/snapshot and exact rollback approval. Both commands update database-side feature flags transactionally and append immutable audit events.
- Deployment `PERSISTENCE_*_STORE` settings are the other key. Identity, organizations and authority must match as one unit; any PostgreSQL core selection requires `PERSISTENCE_LEGACY_API_MODE=disabled`. Feature domains still reject PostgreSQL until their owning route/service adapter exists.
- Optional `PERSISTENCE_SHADOW_DOMAINS` requires database/dataset/domain-bound approval. Only allowlisted natural-key reads are compared; primary responses never consume the secondary result, and logs contain no arguments or values.
- `npm run bootstrap:superadmin` now follows the selected verified core repository, so it cannot silently mutate Mongo after a PostgreSQL cutover.
- The complete operational order, smoke checks, retention policy and rollback boundary are in `docs/runbooks/PERSISTENCE_CUTOVER.md`.

## Authenticated backup, independent restore, and file reconciliation

- `npm run db:backup -- <new-file.cwmbackup>` requires read-only mode, scope, exact `backup:<database>:<schema-sha256>` approval and a canonical base64 32-byte `DATABASE_BACKUP_KEY`. It uses repeatable read, exclusive output creation, schema/migration binding, gzip and AES-256-GCM. The 256 MiB plaintext limit is intentional; production additionally needs managed PITR and encrypted native custom-format backups.
- `npm run db:restore -- <file.cwmbackup> --apply` requires a different migrated target, mutation scope, apply mode and exact `restore:<target>:<archive-sha256>` approval. It rejects unexpected preexisting rows, restores in one serializable transaction and compares a full re-export digest before commit.
- `npm run test:backup:integration` uses exact disposable source/restore URLs, creates and migrates the restore target, authenticates/restores every application row, proves a second restore is rejected and drops the exact target. `.github/workflows/database.yml` runs it after the normal database integration suite.
- `npm run files:reconcile -- <new-report.reconciliation.json>` requires configured private storage plus read-only exact database/bucket/prefix approval. It lists only the configured prefix, checks corresponding HEAD metadata, inventories the optional legacy root without following symlinks and writes an HMAC-authenticated report with no raw IDs/keys/paths. It performs no delete or quarantine action.
- `server/modules/persistence/legacy-removal.js` is a readiness evaluator, not an operator command. It cannot authorize or perform deletion, and it remains blocked until all domains use PostgreSQL, local serving is retired, parity/restore/reconciliation pass, rollback retention expires and legal hold is cleared.
- The normative production/fallback procedure is `docs/runbooks/BACKUP_RESTORE_AND_LEGACY_RETIREMENT.md`.
