# CodeWithMee Security Plan

**Status:** Required controls and release gates  
**Audit date:** 2026-07-31  
**Security posture:** The current application is a local prototype and must not be exposed to untrusted production traffic before Phase 0 completion.

## 1. Highest-priority audit findings and current disposition

| Severity              | Finding                                                                                 | Repository evidence                                                                                                                                  | Required disposition                                                                             |
| --------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Critical              | Hidden challenge cases and reference solutions are returned to learners                 | challenge list/detail serialize the full `Challenge`; the browser can display `solution` and receives every `testCases` entry                        | create learner/admin DTO separation and versioned tests before any public challenge launch       |
| Critical              | AI response can become stored XSS                                                       | `Sandbox.parseMarkdown` escapes only fenced code then renders all output through `dangerouslySetInnerHTML`                                           | replace with a vetted markdown parser and strict sanitizer; add payload regression tests         |
| Closed (was Critical) | `vm2@3.9.19` was a direct production dependency with critical sandbox-escape advisories | P0A-S5 removed the unused package and its lock tree; dependency tests prevent return                                                                 | keep language-level sandboxing outside the host trust boundary                                   |
| Critical              | Uploaded arbitrary post files are publicly served                                       | Space accepts up to five 100 MB files without a type filter and `/uploads` is static/public                                                          | stop direct public-disk uploads; private object storage, signatures, scan/quarantine, quotas     |
| High                  | Public profile endpoint overexposes user fields                                         | `GET /api/space/profile/:id` selects everything except password; can include email, reset fields, notes, conversations, progress and graph internals | explicit public profile DTO and field-level privacy tests                                        |
| Closed (was High)     | Pending companies could log in and publish                                              | P0B-S3 gates publishing on approved provider state; P0B-S4 retired Company credentials/provider writes                                               | preserve organization membership and verification policy on Phase 2 course routes                |
| High                  | Paid and private course controls are not authoritative                                  | paid course enrollment has no payment gate; full public course content is returned; progress accepts arbitrary IDs; download control is UI text      | entitlement policy, payment state machine, versioned course content, validated derived progress  |
| Closed (was High)     | JWT was long-lived in `localStorage`                                                    | P0B-S5 source tests plus P0F-S3 Chromium login/cold-refresh fixtures prove module-memory Bearer, rotating HttpOnly refresh/CSRF and no legacy transport | retain CSP/XSS defense and repeat the contract against a disposable real backend before launch   |
| Closed (was High)     | Protected browser flows lacked role, external-request and automated a11y evidence      | P0F-S3 runs five deterministic Chromium journeys, denies unexpected API/external traffic, isolates learner/provider contexts and blocks serious/critical axe findings | keep fixtures synthetic and extend to real-backend, cross-browser, keyboard and screen-reader gates |
| High                  | Code execution is synchronous and insufficiently bounded at application layer           | API calls `http://localhost:2000` directly with no axios timeout, queue, concurrency control, authentication, or circuit breaker                     | private execution plane, signed jobs, quotas, time/memory/output limits, queue/circuit breaker   |
| High                  | No API rate limiting or abuse budget                                                    | authentication, YouTube, AI, execution, upload, social, and report endpoints lack limiters                                                           | layered per-IP/user/org limits plus global provider budgets                                      |
| High                  | Notes/media rich HTML is stored unsanitized                                             | note content uses `innerHTML`, reassigns it, and exports executable HTML                                                                             | restricted document format or sanitize on input/output; safe export                              |
| High                  | Client dependency audit retains two conflicting React Router advisory ranges            | root/server production trees are clean; the latest verified Router v7 and npm's suggested downgrade each intersect a different advisory              | monitor for a clean supported release; do not force a vulnerable downgrade                       |
| Medium                | Large JSON body limit remains route-global                                              | CORS now uses an exact allowlist and credential flag, but `express.json({limit:'50mb'})` is still global                                             | apply route-specific schemas/body limits and production headers/CSP                              |
| Medium                | Database failure does not stop readiness/listening                                      | connection error is logged and server continues                                                                                                      | readiness gating and fail-fast for required dependencies                                         |
| Medium                | Social graph/credits are non-transactional and farmable                                 | follow/block update multiple users separately; posts/comments grant repeatable points; like removal does not reverse points consistently             | database transactions, idempotency, immutable credit ledger, abuse rules                         |
| Mitigated (was Medium) | Local uploads contain user identifiers and one tracked user byte                        | P0E-S5 freezes all 43 files, ignores future runtime bytes, keeps production serving at `410`, quarantines the promo, and records redacted checksum/metadata evidence; one JPEG and prior promo commits remain in Git history | complete authoritative owner/object parity and retention; remove working-tree/history bytes only through separately owner-approved remediation |

No secret rotation, Git-history rewrite, legacy-upload deletion, publication, or production mutation was performed. P0E-S5 moved only the non-user promo byte-for-byte to a non-deployment quarantine.

## 2. Threat model

### Protected assets

- passwords, sessions, email addresses, OAuth identities, organization membership;
- private courses, invitations, assessments, answer keys, hidden tests, grading rubrics;
- learner submissions, assignment ZIPs, payment proofs, notes, AI conversations;
- private/friends-only ideas, collaborator artifacts, repository/demo links;
- object-storage contents and signed URLs;
- AI, email, video, database, queue, and runner credentials;
- virtual-credit ledger, provider analytics, moderation reports and actions;
- application availability and runner capacity.

### Main adversaries

- unauthenticated automated abuse of login, email, AI, video, uploads, and execution;
- authenticated learners attempting IDOR, hidden-test extraction, grade/progress/credit manipulation, or runner escape;
- malicious provider members attempting cross-tenant access or privilege escalation;
- abusive social users evading blocks, farming credits, uploading harmful media, or brigading reports/votes;
- compromised browser/extension/session token;
- malicious AI content/prompt injection and unsafe generated starter projects;
- supply-chain compromise and leaked deployment secrets;
- accidental operator error, data loss, and privacy leakage.

## 3. Authentication requirements

- Local passwords use Argon2id with parameters benchmarked for the production tier and upgraded on login when policy changes.
- Minimum length is 12 characters; allow password managers and long passphrases. Screen against known-compromised passwords without logging the value.
- Email verification is required for provider membership, invitations, paid enrollment proof, extension authorization, and sensitive social actions.
- Google login uses authorization code + PKCE, validates issuer/audience/state/nonce, and never uses Google subject as a placeholder password.
- Access tokens live 10-15 minutes and are kept in memory by the web client. Refresh tokens are random, hashed at rest, rotated, family-tracked, and placed in `Secure; HttpOnly; SameSite=Lax` cookies.
- Refresh reuse revokes the token family and raises an alert/audit event. Logout and password reset revoke relevant sessions.
- Recent authentication is required for password/email changes, all-session logout, organization ownership changes, platform role changes, payment configuration, and destructive account operations.
- Login/reset/verification responses do not reveal whether an email exists.
- Banned/suspended state is checked at session refresh and sensitive mutations, not only at a few feature routes.
- Extension auth uses registered OAuth client + PKCE, narrow scopes, short access tokens, rotating refresh tokens, and VS Code SecretStorage. Password collection in the extension is prohibited.

## 4. Complete authorization model

### Platform roles

| Role                         | Core powers                                                                              | Explicit exclusions                                                                                                      |
| ---------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `learner`                    | own profile/content/progress, enrolled learning, permitted social/idea/workspace actions | no provider/admin/moderation access by default                                                                           |
| `moderator`                  | review assigned social reports, hide content, warn/suspend within policy                 | cannot grant platform roles, approve providers/payments, view unrelated private learning data, or act on superadmins     |
| `superadmin`                 | provider verification, platform role/status administration, policy-level moderation      | no automatic access to passwords, raw tokens, hidden source secrets, private file bytes without audited break-glass flow |
| `support` (optional Phase 6) | limited account troubleshooting with explicit audited tools                              | no content moderation, grading, payment approval, role grants                                                            |

### Organization roles

| Role         | Permissions                                                                                                |
| ------------ | ---------------------------------------------------------------------------------------------------------- |
| `owner`      | organization profile, staff/roles, all course and analytics actions, payment reviewers, ownership transfer |
| `admin`      | staff below owner, course lifecycle, enrollments, analytics; no ownership transfer or owner removal        |
| `instructor` | assigned course authoring, learner view, announcements; publish only if separately granted/configured      |
| `grader`     | assigned quiz/assignment queues, feedback and regrade; cannot edit answer keys after attempts begin        |
| `analyst`    | aggregate course/enrollment analytics; no raw private submissions/payment evidence by default              |

A user can hold multiple organization memberships and remains one identity. Platform and organization roles are independent.

P0B-S3 enforces this model on the new `/api/v1` organization surface: organization context is loaded server-side, active membership must match both user and tenant, admins cannot grant or mutate peer/owner authority, owner changes are rejected outside the dedicated future transfer workflow, and provider review requires a current superadmin session plus recent authentication. Staff invitations are normalized-email-bound, expiring, single-use and HMAC-hashed at rest; only the mail adapter receives the raw value. Draft/pending/rejected providers may prepare drafts but cannot publish, manage enrollments or review payments. P0B-S4 subsequently retired Company authority and placed protected compatibility handlers behind the current principal.

### Course-scoped roles

| Role               | Permissions and ceiling                                                                                                                   |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `manager`          | course draft, staff, enrollment, grading, analytics and publishing operations; available only to an active organization owner/admin       |
| `instructor`       | assigned course draft/content, learner roster and permitted submission views; publishing requires an explicit grant and approved provider |
| `grader`           | assigned learner submissions, grading, feedback and regrade within locked-answer-key rules                                                |
| `analyst`          | aggregate analytics for the assigned course; no raw submissions or payment evidence                                                       |
| `payment_reviewer` | manual payment review for the assigned course; requires explicit assignment and does not grant authoring/grading                          |

Course assignment is an intersection with an active same-tenant organization membership, never a second route to privilege. Owner/admin retain their organization-level course powers; lower organization roles can receive only the matching course role. Course, membership and assignment organization IDs must agree. Platform roles, including `superadmin`, do not implicitly grant private tenant/course access. The normative contract and transition rationale are [ADR 0001](adr/0001-unified-identity-authorization.md).

### Creative Space roles

| Role             | Permissions                                                             |
| ---------------- | ----------------------------------------------------------------------- |
| idea `owner`     | visibility, collaborators, delete/archive, all edits                    |
| idea `editor`    | edit idea, notes, links, files, updates, prototypes, blueprint requests |
| idea `commenter` | comments and structured suggestions, allowed votes                      |
| idea `viewer`    | read only                                                               |

### Core authorization rules

- Deny by default; every route names a policy action.
- Server loads current roles/memberships; it does not trust a browser account type or stale JWT role.
- Tenant scope is part of every provider query. `resource.organization_id` must match an active membership with the required role.
- Child-resource access is derived from its parent policy: a guessed lesson, file, idea note, comment, blueprint, or submission ID cannot bypass course/idea ownership.
- Blocks apply in either direction to discovery, profiles, feeds, comments, comparisons, follows, and notifications.
- Private/friends-only visibility is evaluated in database queries and detail policies.
- Moderators operate through cases/actions. Direct silent data mutation is prohibited.
- Superadmin actions enforce hierarchy, self-demotion protection, last-superadmin/last-owner rules, recent auth, reason capture, and audit.
- Break-glass access to payment proof/private file/learner source requires explicit reason, elevated permission, short duration, and immutable audit.
- Policy decisions use stable permission IDs and server-built principal/resource context. Unknown permissions, inactive accounts, missing parent context and mismatched tenant IDs deny by default with an auditable reason code.

P0B-S4 applies the current-principal rule to every remaining protected compatibility handler. `Authorization: Bearer` is verified by the unified identity service, which reloads the session and User; handlers receive only the resulting user ID plus server-owned authorization context. Legacy auth/company credential endpoints no longer mint tokens. P0D-S6 deletes the temporary `x-auth-token` parser, recovery principal, configuration switch and `JWT_SECRET` alias in every environment. Platform lists/status operations use stable permissions, recent authentication where required and narrow DTOs; old role/delete mutations remain retired in favor of audited invariant-safe workflows.

P0B-S5 applies the session contract in the web client. The access token is never written to `localStorage` or `sessionStorage`; all feature requests flow through one typed boundary that adds Bearer and session-bound CSRF, includes cookies, and permits only one concurrent refresh. Cold start uses refresh-cookie bootstrap, logout/session revocation clears memory and broadcasts across tabs, and Google begins at the server code-flow endpoint. Exact allowlisted cross-origin deployments enable credentials; recursive source tests reject old auth endpoints, headers and persistent-token keys.

P0B-S6 closes the privileged authority gap. There is no public bootstrap endpoint: an operator-only one-shot command promotes an existing verified active user only when no active superadmin and no consumed bootstrap marker exists. Versioned role/status and ownership endpoints require recent authentication, normalized reason, current server-loaded authority, exact input fields and optimistic revisions. A serialized platform lock prevents concurrent cross-demotion, target sessions are revoked with authority changes, ownership swaps both memberships and the organization owner, and a field-allowlisted append-only audit event commits in the same transaction. Mongo deployments without transaction support return `503` without mutation; Phase 0C carries these invariants into PostgreSQL.

P0C-S1 implements the empty PostgreSQL security boundary. Credential/session/one-time hashes have shape checks and unique/partial-unique lifecycle constraints; organization ownership is revalidated by a deferred constraint trigger; audit updates/deletes are rejected in the database; file rows require exactly one owner and clean/hash/timestamp state before readiness/public visibility. Database write commands require an explicit safety scope, restrict disposable targets to loopback test/dev names, reject a production `postgres` superuser and require an exact environment/database approval. The authorization seed contains definitions only. Managed service roles, encrypted connections/backups and source-data access remain activation gates, not inferred local evidence.

P0C-S2 implements the source-data handling boundary. Migration code cannot fall back to the application URI and fails unless an operator supplies a dedicated URL, read-only mode, exact database approval and an allowlisted server-reported role. Canonical collection records are encrypted as separately authenticated AES-256-GCM frames with collection/index-bound associated data; the manifest is checksum- and HMAC-protected. Reports contain counts, structural field/index data, checksums and HMAC fingerprints only. Raw emails, credentials, reset/session/invitation values, record IDs, upload paths and private content are excluded. Unknown collections, unsafe paths/symlinks, wrong keys and live import attempts fail closed. Generated artifacts and both independent 32-byte keys must remain outside source control and under operator-only access.

## 5. Input, output, and browser security

- Strict runtime schemas reject unknown fields, invalid enums, oversized strings/arrays, invalid UUIDs, and impossible state transitions.
- Store rich text as a restricted structured document where feasible. If sanitized HTML is used, apply a conservative allowlist on the server and render through one audited component.
- AI markdown is parsed by a maintained library and sanitized. Raw HTML is disabled. URL schemes are allowlisted (`https`, limited `mailto` where needed); `javascript:`, `data:` and unsafe SVG are rejected.
- Provider URLs are canonicalized and validated. Embedded video supports explicit providers; arbitrary iframe URLs are not rendered.
- Set CSP with nonces/hashes and a minimal `connect-src`, `img-src`, `media-src`, and `frame-src`; add HSTS, `X-Content-Type-Options: nosniff`, restrictive `Referrer-Policy`, `Permissions-Policy`, and frame protection.
- Production CORS is an exact origin allowlist; credentials are allowed only for the official web origins.
- Cookies and state-changing endpoints use origin/CSRF defenses. Bearer-only extension calls do not rely on cookies.
- Error responses are generic; stack traces, provider error bodies, Mongo/Postgres internals, file paths, test data, and key prefixes stay out of client responses.
- Logs redact authorization, cookies, tokens, emails where not required, code/source by default, AI prompts, payment references, and signed URLs.

## 6. File and media security

- The API issues purpose-specific upload intents; the browser uploads directly to private object storage.
- Enforce size, count, declared MIME, allowed extension, and user/org quota before upload; verify magic bytes and actual MIME after upload.
- Quarantine until malware scanning and media validation complete. Content is not attachable or downloadable while pending/quarantined.
- Rename to opaque storage keys; original filenames are metadata only and safely encoded in content disposition.
- Images are decoded/re-encoded where practical; strip metadata. SVG is rejected or sanitized by a dedicated pipeline and served as attachment.
- Videos use an allowlist, duration/dimensions/codec limits, transcode pipeline, poster generation, and no active content. Video is free-tier experimental and paid at sustained use.
- ZIP assignments are inspected only in an isolated worker with zip-slip, symlink, device file, file-count, expanded-size, compression ratio, nesting, and timeout controls.
- Download authorization is reevaluated for every signed URL. `allowDownload=false` means the API never issues a download URL; it is not merely UI text.
- Deleting a parent record schedules reference-aware object cleanup after a recovery window. Orphan scans reconcile DB and storage.

## 7. Secure code execution

Regex command blocking is defense-in-depth only and is not considered sandboxing.

Required execution design:

- The trusted API creates a signed, immutable execution job and sends only required source/test material to a private execution gateway.
- Runners have no application database, object-storage, queue-admin, AI, email, or JWT secrets.
- Each job receives a new isolated namespace/container or microVM, unprivileged UID, read-only base image, writable ephemeral volume, seccomp/AppArmor (or equivalent), cgroup v2 limits, process/file descriptors limits, and cleanup.
- Outbound network is disabled by default. DNS and metadata endpoints are unreachable. No Docker socket, host mount, device, or cloud credential is present.
- Pin runtime images by digest and supported versions; scan and rebuild them. Do not accept `version: '*'` in production jobs.
- Enforce compile/run wall time, CPU, memory, process count, file count/size, total source bytes, stdin bytes, stdout/stderr bytes, and concurrent jobs.
- Authenticate and encrypt API-to-gateway traffic; use nonce/job expiry and result signatures to prevent replay/tampering.
- Challenge hidden tests are decrypted/materialized only in the trusted execution path and never sent back in results.
- Separate learner-safe verdicts from internal runner diagnostics.
- Rate limits combine user/org/IP concurrency and rolling CPU budgets. Circuit breakers shed load and return retryable states.
- Regular adversarial tests cover fork/output/memory/disk bombs, filesystem traversal, network/metadata access, cross-job leakage, compiler abuse, and sandbox escape attempts.
- Production runner capacity is a paid infrastructure requirement. Free deployment may support only local runner development or a disabled/demo execution feature.

## 8. AI security and safety

- One AI gateway owns provider configuration, models, budgets, retries, timeouts, logging policy, and safety settings. Feature routes do not rotate arbitrary keys.
- Version system prompts and output schemas. Delimit user/retrieved content as untrusted data; do not let retrieved idea text redefine system behavior.
- Validate structured outputs and reject unknown/unsafe fields. Generated code/project files go through repository path/content rules and dependency allow/deny policy.
- Never automatically execute generated code, push to a repository, send email, publish a course, or mutate an idea without explicit user confirmation and authorization.
- Apply per-user/org daily quotas, model token caps, global budget alarms, and graceful deterministic fallbacks.
- Inform users what content is sent to an AI provider and provide retention/delete controls.
- Store prompt/model/safety/provenance versions for reproducibility without logging secrets or unnecessarily retaining private source.
- AI blueprints are suggestions, not professional guarantees. Provide reporting and human review for harmful or infringing output.

## 9. Social, moderation, and credit abuse controls

- Use desired-state idempotent reactions/follows instead of toggle endpoints vulnerable to retries.
- Create credits only from versioned, server-observed activity policies. Posting/deleting repeatedly cannot mint unlimited value.
- Awards debit and credit atomically through an immutable ledger; negative balances are rejected.
- Streaks derive from qualifying events with timezone policy and reconciliation; clients never set streak counters.
- Enforce creation/account-age/velocity limits for posts, comments, follows, votes, awards, invitations, and reports.
- Detection flags are evidence, not automatic guilt. Moderator actions use documented reasons/durations and an appeal path.
- Preserve reports/evidence under restricted access and retention. Reporters are not exposed to the reported user.
- Blocking severs graph edges and suppresses both directions. Historical shared course/provider data follows separate entitlement rules.

## 10. Secrets, dependencies, and supply chain

- Store production secrets in the deployment secret manager; `.env` is local only. Validate required configuration at startup without printing values or key prefixes.
- Rotate JWT/session signing keys, database, object storage, email, AI, video, queue, and OAuth credentials under a documented schedule and after incidents.
- Use separate credentials and least privilege for API, worker, migration, CI, and runner.
- Commit lockfiles; use deterministic installs (`npm ci`), dependency review, secret scanning, SAST, and container/image scanning in CI.
- Phase 0 removes unused `vm2`, `python-shell`, `piston-client`, duplicate AI SDKs, and other unused dependencies after confirming references.
- Migrate off unmaintained CRA/react-scripts to Vite. Critical/high advisories block release unless a time-limited, owner-assigned exception documents reachability and mitigation.
- Pin GitHub Actions by full commit SHA and minimize workflow token permissions.
- Generate an SBOM for releases and record artifact provenance/checksums.

## 11. Logging, audit, privacy, and incident response

- Structured application logs include timestamp, level, service, environment, correlation ID, actor ID (pseudonymous where possible), route/action, result, duration, and error category.
- Security audit events cover login/session changes, role/membership changes, provider verification, publishing, grading/regrading, payment review, moderation, private-file access, extension authorization, repository export, and backup/restore.
- Audit rows are append-only and separately access-controlled. Admin UI cannot edit/delete them.
- Define incident severities, on-call contacts, containment steps, token/secret revocation, user/provider communications, evidence preservation, and post-incident review.
- Publish privacy/terms/community/upload/AI/payment policies before real-user production launch.
- Account export/deletion, consent, retention, and minor-user considerations require legal/product review for the launch jurisdictions.

## 12. Security testing gates

### Phase 0 gate

- Unit/integration tests for auth, refresh rotation/reuse, role hierarchy, cross-tenant IDOR, DTO redaction, validation, CSRF/CORS, rate limits, and upload-intent policy.
- Stored/reflected XSS payload tests for AI, notes, course content, posts, comments, suggestions, profiles, URLs, and filenames.
- Dependency audit has no untriaged critical/high production vulnerabilities.
- Secrets scan and current Git-history exposure review complete.

### Phase 1 gate

- Hidden tests/reference/checker do not appear in learner APIs, logs, bundles, analytics, or errors.
- Runner escape/DoS/network/cross-job tests pass; capacity and circuit-breaker load tests pass.
- Duplicate submit requests do not double-score or duplicate submissions.

### Phase 2 gate

- Complete role/tenant matrix tests for course authoring, enrollment, content entitlement, grading, files, analytics, payment review, and invitation redemption.
- ZIP bomb/path traversal/malware workflow tests and paid-content download tests pass.

### Phase 3-4 gate

- Privacy/block tests cover feeds, profiles, comments, comparisons, notifications, idea children, collaborators, and direct-ID requests.
- Report/appeal/audit and credit-ledger invariant tests pass under concurrency.

### Phase 5 gate

- Workspace path traversal, symlink, archive, malicious manifest/dependency, extension token, callback hijack, repository overwrite, and generated-code confirmation tests pass.

### Phase 6 gate

- External penetration test or independent security review of auth, tenant isolation, uploads, execution, and extension flows.
- Backup restore and incident/tabletop exercises complete.
- Security headers, TLS, production CORS, rate limits, alerts, key rotation, and least-privilege credentials verified in the deployed environment.

## 13. Safe fallbacks

- If a secure production runner cannot be funded, ship challenges with authoring/read-only examples but disable hosted Run/Submit; allow a documented local developer runner only.
- If video scanning/transcoding is unavailable, permit only validated external YouTube links and images; reject direct video upload.
- If antivirus scanning is unavailable, do not accept ZIP/binary assignment uploads; accept text answers and restricted source file types.
- If rich-text sanitization cannot be proven, store/render plaintext or restricted Markdown with raw HTML disabled.
- If payment review staffing/auditing is unavailable, offer only free/private-invite courses; do not label manual proofs as automated payments.
- If moderation capacity is unavailable, restrict social/idea visibility and media posting to a small invite-only beta.

## 14. Security definition of completion

Security is complete for a release only when its phase gate passes in CI and the deployed environment, identified high/critical risks have an owner and disposition, authorization/redaction tests cover every endpoint, and the release does not depend on a documented safe fallback while claiming the ideal feature is available.

## 15. P0C-S3 private-file controls

The implemented boundary generates opaque random object keys under a validated environment prefix; the original filename remains metadata and is encoded only in download disposition. Purpose policies jointly constrain owner type, extensions, declared MIME and maximum bytes. Upload intents require lowercase SHA-256 and return a short PUT whose signed command includes content length/type, checksum and file metadata. Completion verifies provider HEAD metadata before emitting a scan request. Only an internal trusted scan transition can mark the row clean/ready; mismatches, infection, unscannable content and scanner failure quarantine it. A ready file is reauthorized before every short GET.

The public DTO excludes bucket, object key, SHA-256 and quarantine reason. User and organization IDOR attempts are denied before metadata is returned, and object keys cannot be derived from user filenames. Production requires HTTPS for a configured custom S3 endpoint, `FILE_SCANNER_MODE=external`, database-backed UUID principals and disabled legacy local serving. Cleanup requires an exact `cleanup:<bucket>` operator token and bounded retention values; it marks records deleted before best-effort object removal.

Activation still requires a private bucket policy, narrow workload identity, provider CORS/checksum interoperability, authenticated scanner consumption/result delivery, replay/idempotency checks, lifecycle/versioning and audit/alert evidence. Until then the runtime returns unavailable and files remain pending. ZIP and video are rejected instead of accepted without safe archive analysis, antivirus/transcode and delivery capacity.

## 16. P0C-S4 import security boundary

The PostgreSQL writer cannot open MongoDB and refuses fixture/plaintext sources; it consumes only a manifest-authenticated AES-256-GCM snapshot. Execution requires the database mutation guard, `--apply`, `MIGRATION_IMPORT_MODE=write` and an approval containing the exact target database plus full dataset SHA-256. Staging/production additionally require an explicit write-freeze confirmation. The default record ceiling is 250,000 and the hard maximum is 5,000,000 so an unexpected snapshot cannot cause unbounded memory or target writes.

Source primary/foreign identifiers are converted to deterministic UUIDv5 targets but only HMAC fingerprints enter provenance/operator output. SQL is parameterized and one source record owns one transaction; failed constraints roll back the record before a separate quarantine record is written. Stored exception details contain safe field/error codes only. Integration checks confirm sampled emails, raw IDs, private notes/posts, reference solutions and employee IDs do not enter run/exception JSON. Domain tables intentionally contain migrated private content and remain inaccessible until their future resource policies are implemented.

## 17. P0C-S5 cutover security controls

- One domain has one response/write authority; runtime dual writes are forbidden.
- Identity, organization and authority cut over and roll back together. PostgreSQL selection fails configuration unless the direct legacy API is disabled.
- Premature learning/challenge/course/social/idea/integration PostgreSQL settings fail before database connection or listener creation.
- Parity uses an independent canonical 32-byte HMAC key, a read-only repeatable-read transaction, exact target/dataset approval and exclusive non-symlink output. Reports contain no source IDs, emails, file paths, raw exceptions or secrets.
- Activation requires every selected domain to be ready, an exact database-bound approval, final report/dataset/snapshot hashes, future source-retention deadline, confirmed write freeze, rehearsed rollback and operator reference.
- Database feature flags and deployment settings must match exactly. Missing, tampered or stale records prevent startup; neither control can switch authority alone.
- PostgreSQL sessions store hashes only. Refresh-token rotation is transactional; reuse marks the family compromised and revoked. Raw provider avatar URLs are not persisted by the current adapter; a later reviewed file-ingest path may replace this privacy-safe omission.
- PostgreSQL authority uses serialized control-row locking, current actor lookup, optimistic revisions, last-superadmin protection, transactional session revocation/ownership swaps and append-only audit session/request/occurrence fields.
- Shadow reads are allowlisted natural-key operations. Secondary errors cannot fail or change the primary response; comparison strips identifiers, timestamps and secrets, hashes projections and logs only domain, method and outcome code.
- Rollback requires another freeze and exact matching generation/snapshot. It never copies PostgreSQL writes blindly into Mongo, and expired retention removes the automatic-rollback option.

The local fixture has nine quarantines and therefore does not authorize core cutover. Synthetic ready-state activation/rollback verifies control mechanics only; no live security claim is inferred.

Transient authority is deliberately invalidated. Sessions, reset/verification tokens and pending invitation tokens are reissued; legacy company credentials never become user identities; Google linking requires a provider subject; audit reasons stay in the protected source and become a generic migration reason; cache queries are hashed. Missing currency, identity uniqueness, parents, author/owner mapping or valid role state means quarantine. A reconciled fixture run does not authorize traffic: P0C-S5 owns shadow parity, single-store write authority, feature-flag rollback and the source retention window.

## 18. P0C-S6 recovery security controls

- Portable archives use canonical 32-byte keys, AES-256-GCM, authenticated headers, gzip output bounds, exact schema/migration binding, exclusive non-symlink paths and aggregate-only stdout. Keys and archives are ignored private artifacts and must use separate secret/backup custody in production.
- Restore needs apply mode, an exact target/archive approval and a different database. It rejects unexpected bootstrap/preexisting rows, unsupported foreign-key cycles, authentication/checksum failure and any content mismatch; all writes roll back together.
- Reconciliation is read-only and prefix-bound. Reports replace file IDs, object keys, bucket/prefix and legacy paths with independent HMAC references and never expose source filenames or delete/quarantine data.
- Legacy removal cannot execute. All-domain PostgreSQL authority, disabled legacy/local serving, authenticated parity, independent restore, clean file report, expired rollback retention, legal-hold clearance and a new exact destructive approval are separate mandatory gates.
- The portable verifier is not production disaster recovery. Managed PITR, encrypted native exports, isolated object versions/replication, key rotation, restore drills and monitoring require paid/contracted infrastructure as data value grows.

## 19. P0D-S1 transport-contract controls

- All 37 implemented v1 operations have explicit request schemas with recursive unknown-field rejection and no type coercion. Parameters use bounded opaque identifiers during Mongo/PostgreSQL compatibility; target response IDs remain UUID-shaped.
- Validation issues contain a stable code and JSON pointer only. Input values, passwords, tokens and provider details are never reflected. At most 20 issues are emitted.
- OpenAPI response allowlists omit password/token hashes, session secrets, storage bucket/key/checksum/quarantine fields and legacy repository records. The ownership-transfer DTO was changed to explicit membership and organization fields.
- Cursor payloads are versioned and HMAC-authenticated with a minimum 32-byte key. Invalid signature, shape, version or bounds returns no decoded state.
- Revision ETags and idempotency keys have exact parsers. Durable request replay is not claimed until P0D-S6; the current boundary validates only syntax.
- The in-repository validator is a reviewed subset, not a general JSON Schema engine. Unsupported keyword additions require code and negative tests; the service layer remains mandatory defense in depth.

## 20. P0D-S2 errors, logs and health disclosure

- The final handler exposes only approved domain codes. Unknown exceptions become `500 internal_error`; parser errors do not include submitted fragments; query strings are removed from the problem instance.
- Correlation IDs accept only 8-100 safe characters and otherwise become server UUIDs. They are not authorization or idempotency material.
- Structured logs redact sensitive keys recursively, bound depth-by-entry count and value length, serialize cycles safely, and never receive request bodies, raw URLs, identity values or provider response payloads.
- Retained legacy AI/YouTube/roadmap/challenge/user/course/space routes no longer print prompts, generated content, provider payloads, file errors, key prefixes, query text, video IDs or exception messages. One safe domain/operation/error code replaces those logs.
- Public liveness/readiness disclose no dependency list. The detail route authenticates a current access token and reuses the deny-by-default superadmin permission path.
- Probe failure and timeout both fail required readiness closed. Optional unavailable integrations are explicit only to the privileged view.

## 21. P0D-S3 browser, parser and abuse controls

- Credentialed CORS has no wildcard or reflection fallback. Exact origins, methods, allowed headers, exposed headers and a ten-minute preflight lifetime are fixed at construction.
- Unsafe requests with an untrusted origin or untrusted cross-site Fetch Metadata fail before the body parser. Trusted split-origin SPA writes remain valid; originless non-browser calls still require their normal authentication. Cookie refresh/logout keep session-bound double-submit CSRF.
- API responses default to no-store and receive a restrictive CSP, clickjacking, MIME sniffing, referrer, permissions, opener/resource policy and production HSTS headers. The framework signature is disabled.
- JSON is strict, uncompressed and operation-bounded at 8, 32, 64 or 256 KiB. Unsupported encoding, excessive size and malformed content return stable problem codes without values.
- Named fixed-window limits separate reads, writes, authentication, administration, upload, execution and external-provider work. Preflight is exempt. Keys are HMAC pseudonyms; raw IPs, users and account identifiers are not stored or reflected.
- `X-Forwarded-For` is ignored unless the direct peer is in an exact reviewed proxy network. Empty trust is the safe default; wildcard `/0` networks are rejected.
- The memory store has a hard key ceiling and fails closed when exhausted. It is safe only for a single instance. Multi-instance production requires a shared atomic store, edge limits, monitored capacity and explicit failover policy in Phase 6.

## 22. P0D-S4 stored-content controls

- AI/provider text is untrusted even when generated by the platform. Restricted Markdown is parsed into a fixed React node allowlist; raw HTML, links, images, iframes and extension syntax are never interpreted.
- Notes are versioned plaintext documents. Paste is forced to `text/plain`, save reads text rather than markup, downloads are `.txt`, and attachment DOM is constructed with element properties/text nodes rather than interpolation.
- Compatibility HTML is stripped only into a display projection. The original remains marked `legacy_html_v0` until explicit save or reviewed migration, preventing silent data corruption and false sanitization claims.
- Client source tests forbid `dangerouslySetInnerHTML`, raw `innerHTML` assignment, HTML insertion commands, `srcDoc` and `document.write` across the complete source tree.
- HTTP(S) is the only navigation/media scheme; credentials are rejected. YouTube embeds use exact hosts/IDs, a privacy-enhanced origin, referrer policy and sandbox.
- Server normalization removes unsafe controls, normalizes line endings, enforces exact envelope keys/version/format and rejects over-limit content instead of truncating it.

## 23. P0D-S5 operation, scope and response controls

- Every v1 operation is covered exactly once by an executable security manifest. Unknown operations, unknown permissions, missing scope declarations and extra stale entries fail tests.
- Public, optional and Bearer-current authentication are explicit rather than inferred from route naming. Organization, file and self resources must retain their scope, and privileged platform operations name a catalogued permission.
- Access tokens and signed upload/download URLs are the only reviewed ephemeral capability families. Their five emitting operations are enumerated; introducing another capability is a review-gated code change.
- Public component schemas are recursively scanned for credential, secret, hash, storage-key, provider-token and quarantine internals. DTO tests project deliberately contaminated repository records and assert those fields remain absent.
- Audit state is a closed allowlist with `additionalProperties: false`; arbitrary before/after persistence JSON cannot become an audit API disclosure.
- The claim covers the executable `/api/v1` registry. Retained unversioned feature routes are compatibility-only until their owning roadmap phase migrates or retires them.

## 24. P0D-S6 audit, replay, worker and compatibility controls

- Idempotency keys are validated at transport, combined with actor and operation, and persisted only as a SHA-256 scope. Canonical request digests detect key reuse with different input; leases prevent duplicate active execution and permit bounded crash recovery.
- Replay storage accepts only bounded JSON and 2xx–4xx status. Credential/token/cookie/secret/hash field families are rejected, so access and refresh tokens cannot become replay records.
- Audit state requires an explicit allowlist and rejects security-sensitive field names even if requested. Envelopes are bounded, immutable and append-only; operation-key reuse with different action/target/state fails `409`.
- Outbox claims use database locks, expiring job leases, bounded batches/attempts/backoff and stable internal error codes. Payload and upstream exception text never enter worker logs.
- Production operations require PostgreSQL. The bounded memory implementations are deterministic development/test fallbacks only and cannot support multi-instance correctness, restart durability or compliance audit retention.
- The server accepts only current Bearer access tokens or the refresh-cookie contract. The old header parser, local recovery identity and configuration secret aliases are absent and protected by negative source tests.
- Active unversioned feature routes remain an inventoried migration surface, not an authentication fallback. Their phase ownership and the global `410` cutover switch prevent silent indefinite compatibility.

## 25. P0F-S4 CI and software-supply-chain controls

- Every external GitHub Action is pinned to a reviewed 40-character commit SHA; every workflow/Compose image must use a sha256 digest. Checkout does not persist credentials, top-level permissions are read-only and every runnable job is time-bounded.
- CodeQL JavaScript/TypeScript analysis runs in its own job with `security-events: write`; ordinary quality and browser jobs retain `contents: read` only. `pull_request_target` and broad permission presets are rejected by the repository workflow gate.
- npm audit findings fail unless the complete dependency graph maps to an exact advisory/workspace/package/severity exception with a reason and unexpired date. An absent/fixed finding makes the exception stale and fails until it is removed.
- Lockfile license values must be in the reviewed allowlist. Non-standard or missing metadata requires an exact package/version/value/reason/expiry exception. Strong-copyleft/unknown changes fail closed; this is an engineering gate, not a substitute for owner/legal approval.
- Secret scanning covers known provider formats, private keys, sensitive hardcoding and non-synthetic credentialed database URLs across repository text. Recognized binary media is not decoded; oversized unknown text fails. Git history and provider-side revocation remain separate checks.
- Current container policy proves the one PostgreSQL service digest and reports that no deployable image exists. Runtime image CVE, SBOM, provenance and signature gates cannot be claimed until Phase 6 creates images.
- Browser failure artifacts are fixture-only, retained seven days and contain no video. No policy step receives production credentials or authorizes deployment.

## 26. P0F-S5 observability disclosure controls

- Trace and span identifiers are random correlation material, not identity/authorization inputs. Incoming trace context must match the exact W3C shape and nonzero IDs.
- Metrics use bounded keys and only normalized method/status/error-code labels; user, tenant, resource, IP, URL/query, body and provider values are forbidden.
- Error-reporting adapters receive code/name/route/status/request ID/trace ID only. Message, stack, request data and principal data remain excluded, and reporter failure cannot affect the response.
- Synthetic checks reject credentials/query/fragment, require HTTPS except loopback, follow no redirects and test only aggregate live/ready state.
- Phase 6 exporter activation requires endpoint authentication, TLS, sampling/cardinality budgets, access/retention policy and PII/source-map review.
