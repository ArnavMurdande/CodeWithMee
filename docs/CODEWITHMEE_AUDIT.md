# CodeWithMee Repository and Product Audit

Audit date: 2026-07-31  
Repository: `C:\Users\Arnav\Desktop\CWM\CodeWithMe`  
Scope: Read-only product/architecture audit and complete implementation roadmap. No production feature was implemented.

## 1. Executive assessment

CodeWithMee is a broad, visually developed prototype, not a production-ready platform. Its strongest reusable assets are the React learning/social/provider screens, Monaco-based coding experiences, early course and social domain concepts, and a working Express/MongoDB prototype API. The build completes, but no automated test foundation exists, security-sensitive DTOs leak data, authorization is incomplete, the current code runner is not a secure hosted execution boundary, uploads are public and ungoverned, and several relational workflows are embedded in oversized MongoDB user/course/post documents.

The recommended destination is a modular monolith: React/Vite/TypeScript web and extension clients, a versioned Express/TypeScript API plus worker, PostgreSQL with Prisma, private S3-compatible object storage, and a separately isolated execution plane. This retains operational simplicity while drawing the essential trust boundary between the application and untrusted code. The plan deliberately migrates identity/data foundations in Phase 0 because building provider tenancy, durable submissions, social relationships and collaboration on the current embedded data model would cause expensive rework.

The complete delivery path is Phase 0 repository stabilization; Phase 1 trusted learning/challenges and progress; Phase 2 provider LMS; Phase 3 moderated social platform; Phase 4 collaborative idea workspaces; Phase 5 browser IDE and safe VS Code extension; and Phase 6 production hardening/scale. The ordered, implementation-ready specification is in [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md).

Release judgment: **do not expose the current application as a public production service**. A constrained invite-only demo is feasible after Phase 0, with public uploads and hosted execution disabled. Production code execution, native video, dependable workers, high-volume email/monitoring and human moderation will require paid infrastructure or paid operations.

## 2. Current technology stack

| Layer | Current repository evidence | Assessment |
|---|---|---|
| Web | React 19.1.1, JavaScript/CSS, Create React App/react-scripts 5, react-app-rewired | Builds, but CRA-era toolchain is deprecated/high-debt; migrate to Vite + TypeScript in Phase 0A. |
| Routing/data | React Router 7.9.3, Axios 1.12.2, localStorage JWT | Usable concepts; centralized typed client/auth lifecycle is missing. |
| Rich UI | Monaco, Framer Motion, GSAP, Highcharts, OGL, YouTube/player packages | Valuable prototype assets; several integrations need lifecycle, accessibility and bundle review. |
| API | Node.js, Express 5.1, JavaScript | Broad prototype with approximately 88 route handlers; lacks a versioned contract, global validation/error policy and consistent modular boundaries. |
| Data | MongoDB/Mongoose | Quick prototype fit, but current embedded/mixed-reference structures conflict with product relationships, auditability and transactional invariants. |
| Identity | Custom JWT, bcrypt, Google userinfo token flow; separate User and Company identities | Must be unified and hardened before feature expansion. |
| Files/media | Multer to local `uploads/`, served publicly | Unsuitable for private courses, submissions or user media. Approximately 100 MB of repository uploads were observed. |
| Code execution | HTTP call to local Piston at `localhost:2000` | Not deployable or secure as currently integrated; needs a distinct untrusted execution plane. |
| AI/external | Gemini and YouTube APIs | Useful adapters; secrets, quotas, data consent, injection and failure policies are incomplete. |
| Tests/CI | No meaningful test files or demonstrated CI gate | Phase 0 blocker. |

The target technology choices and rationale are defined in [ARCHITECTURE.md](./ARCHITECTURE.md).

## 3. Current architecture

The browser calls a single Express server directly, frequently through hard-coded `http://localhost:5001` URLs. Express mounts authentication, users, challenges, courses, companies, enrollments, Space/social and project endpoints; serves local uploads; talks to MongoDB; calls Gemini/YouTube; and forwards code to a presumed local Piston service. There is no worker boundary, queue, object-storage abstraction, API gateway/versioning policy or trusted-versus-untrusted network separation.

Current request path:

```text
React/Monaco/YouTube UI
          |
          | Axios + Bearer access token
          v
Single Express process ----> MongoDB
     |      |     |
     |      |     +--------> public local uploads
     |      +--------------> Gemini / YouTube
     +---------------------> localhost Piston
```

This shape is acceptable for a private prototype only. The Express process currently starts even after a database connection failure; CORS is permissive; JSON bodies allow up to 50 MB globally; uploaded files are served without entitlement checks; and execution has no durable job/admission boundary.

## 4. Current database model

Nine Mongoose models were found, centered on `User`, `Company`, `CompanyEmployee`, `Challenge`, `Course`, `Enrollment`, `Post`, `Project` and supporting records. The exact model inventory is less important than these structural findings:

- `User` contains identity plus roadmaps, conversations, sandbox chats, video progress, notes/attachments/canvas data, solved/saved challenges, points, enrollments, employee profiles, followers/following/requests/blocks and privacy state. This creates unbounded-document and privacy/authorization risk.
- `Challenge` embeds solution and visible/hidden test cases. Current learner reads serialize secrets; submitted `solutionLanguage` is not persisted by its schema. The prior `Submission` model is deleted, so history is not durable.
- `Course` embeds module/content structures. `Enrollment` accepts client-supplied content identifiers/progress, allowing invalid progress and inflated completion. Published-version immutability is absent.
- `Post` embeds recursive discussion/reaction structures and mixes string/ObjectId actor references, making indexing, deduplication and moderation difficult.
- Social relationships are stored as arrays on users and updated across multiple documents without transactions.
- `Project` only represents a minimal public/private project post with milestones and likes; it is not a collaborative Creative Space.

The target relational schema, constraints, indexes, event/outbox records and migration sequence are specified in [DATABASE_PLAN.md](./DATABASE_PLAN.md).

## 5. What currently works

- The client production build succeeds and renders a broad UI prototype.
- User signup/login, Google-based login concept and JWT-protected API calls exist.
- Admin/company approval screens and provider course dashboard concepts exist.
- Challenge catalog/solver/create flows, Monaco editing, visible examples, Piston request formatting and results UI exist as prototypes.
- Video search/playback and timestamp saving/resume are implemented conceptually.
- Course browse/create/edit/view/enroll/progress interfaces and data structures exist.
- Space includes posts, text/media, comments/replies, reactions, saves, awards, profiles, follows/requests, blocks and a leaderboard prototype.
- A standalone sandbox provides multiple language choices, themes, output, YouTube and AI chat.
- Notes, roadmaps/pathways and basic role/points/profile experiences provide reusable UX direction.
- Many pages include mobile media queries, even though key coding/notes flows still intentionally block or hide mobile behavior.

“Works” means present and demonstrable in source/build, not security-reviewed or production-ready.

## 6. What is incomplete

- Unified account and provider membership lifecycle, refresh/revocation/session controls and resource-level authorization.
- Versioned challenge content, correct starter contracts, durable submissions and secret-safe hidden tests.
- Secure, isolated and capacity-controlled code execution.
- Authoritative lesson/module/course progress and robust cross-device reconciliation.
- Provider roles, full authoring, assessment, assignments, grading, invitations, manual payment review and trustworthy analytics.
- Privacy-correct/scalable feed, daily challenges/streaks/comparisons, notifications, immutable credits/awards and moderation operations.
- Creative Space collaboration, artifacts, structured suggestions/votes, history, prototypes and AI blueprints.
- Multi-file IDE persistence/validation and the entire VS Code extension.
- Production topology, object/media delivery, jobs, observability, backup/restore, CI/CD and operational ownership.

## 7. What is broken

- Learner challenge endpoints expose reference solutions and hidden test data; submission failures can return hidden inputs/expected/output.
- Run Code treats an empty visible-test suite as passing, so a challenge with no example cases can produce a false success.
- Generic starter code does not reliably follow the runner's stdin/stdout contract.
- Submission history is not persisted; the prior submission model is deleted.
- The server depends on a local unauthenticated Piston URL with wildcard runtime versions, no request timeout/admission queue/quota/circuit breaker and an ineffective regex “security” filter.
- Company login does not enforce approval, so pending companies can reach protected publishing endpoints.
- Public course detail exposes full content without enrollment for public courses; “paid” enrollment is not payment-gated.
- Enrollment progress accepts arbitrary content IDs and client-controlled completion.
- The Space profile response excludes only password and can expose email, auth/reset fields, notes, conversations, progress and other private state.
- Uploads are publicly served from local disk with weak/no MIME policy, no malware scan, no entitlement gate and no durable deployment storage.
- AI/chat markdown is inserted using `dangerouslySetInnerHTML` after incomplete escaping, enabling stored XSS from model/history content.
- Notes persist raw `contentEditable` HTML and export executable HTML.
- Social XP/credits can be farmed; graph/counter updates are non-transactional; blocking is incomplete; feed queries load/sort/filter in memory and exhibit N+1 behavior.
- Server package code imports `@google/generative-ai`, while the repository root declares the different `@google/genai` package.
- Several current asset references/large video copies are abandoned or licensing/deployment liabilities.

## 8. Build, lint and test results

Commands were run against the existing dirty working tree without changing production source.

| Check | Result | Interpretation |
|---|---|---|
| `client: npm.cmd run build` | Passed; “Compiled with warnings”; approximately 221.43 kB gzip JS and 25.08 kB gzip CSS | Buildable, not warning-clean. |
| `client: npm.cmd exec -- eslint src --ext .js` | Exit 0; 35 warnings, 0 errors | Hook dependency, unused symbol, JSX comment and escape warnings remain. |
| `server: node --check` over JavaScript files | Passed | Syntax only; not behavioral verification. |
| `client: CI=true ... test --watchAll=false` | Failed: “No tests found”; 31 files checked | The repository has no test foundation. |
| `client: npm audit` | 60 advisories: 2 critical, 31 high, 16 moderate, 11 low | React-scripts/transitive debt plus direct Axios exposure; lockfile remediation/migration required. |
| `server: npm audit --omit=dev` | 12 advisories: 1 critical, 7 high, 4 moderate | Direct unused `vm2@3.9.19` is critical; Axios and express-validator paths also need remediation. |

The audit did not claim browser E2E, live database, Gemini/YouTube, email or Piston success because those services were not provisioned as a controlled test environment.

## 9. Security findings

Critical release blockers:

- Challenge solution/hidden-test disclosure and an unsafe code-execution architecture.
- Stored-XSS paths in AI markdown and notes HTML.
- Overbroad profile serialization and public local uploads.
- Missing organization approval/resource authorization and multiple IDOR/tenant-isolation risks.
- No rate limiting, security headers/CSP, robust CORS allowlist, CSRF-aware browser token design, session revocation or global safe error handling.
- Critical/high dependency advisories, including unused `vm2`; `vm2` must be removed, not adopted as the sandbox.

High risks include client-controlled progress, weak file validation, oversized global JSON bodies, localStorage bearer-token theft impact, Google token flow/account-link ambiguity, non-transactional social/credit mutations, mass-assignment on course update, missing audit logs and secrets/config inconsistency. The complete threat model, control plan, authorization matrix and phase security gates are in [SECURITY_PLAN.md](./SECURITY_PLAN.md).

## 10. Technical-debt findings

- Create React App/react-app-rewired and a warning-heavy JavaScript codebase impede typed contracts and current dependency maintenance.
- Approximately 99 client references hard-code the local API origin instead of using one validated client configuration.
- Large page components combine data fetching, policy assumptions, rendering and state orchestration.
- Business rules live in route handlers and clients rather than transactional domain services.
- No OpenAPI contract, migrations, fixtures, factories, tests, CI gates, structured logs, metrics or health/readiness design.
- Duplicated/abandoned components and assets remain; documentation overstates secure execution/submission capabilities.
- Mixed IDs and deeply embedded records prevent reliable constraints and pagination.
- Direct file-system storage and service-specific calls prevent portable deployment.
- Certificates are generated client-side and can be forged; provider/payment/progress claims are not authoritative.
- User-generated and externally generated content lacks a shared sanitization/moderation lifecycle.

## 11. Complete feature-feasibility matrix

Legend: **Reuse** = meaningful prototype exists; **Partial** = concept exists but needs redesign; **New** = no material implementation; **Paid gate** = production reliability/capacity cannot reasonably stay free.

### Phase 0

| Capability | Current | Feasibility and required design |
|---|---|---|
| Build/runtime fixes | Partial | High; Vite/TypeScript migration, centralized config, dependency cleanup and separated app start commands. |
| Authentication review | Partial | High; unify User/Company, short access + rotating refresh/session records, verified OAuth and recovery. |
| Authorization review | Partial | High; organization membership plus centralized resource-action policies and DTO allowlists. |
| Database consistency | Partial | High but foundational; PostgreSQL/Prisma migration with constraints and controlled cutover. |
| Validation | Partial | High; shared schemas at all request/config/job boundaries. |
| Error handling | Partial | High; typed errors, correlation IDs, safe production envelope and boundaries. |
| Logging | Partial | High; structured redacted logs and audit events. |
| Testing foundation | New | High; unit/integration/contract/E2E/security fixtures and CI gates. |
| Mobile responsiveness | Partial | High; replace challenge warning/hidden notes with tested adaptive layouts. |
| Remove broken/duplicate/abandoned | Partial | High; inventory, replacement map, remove only after references/tests; clean uploads/media. |

### Phase 1

| Capability | Current | Feasibility and required design |
|---|---|---|
| Responsive Challenges interface | Partial | High after Phase 0E; catalog and solver need mobile-first layout/accessibility. |
| Problem statements | Reuse | High; sanitize, version and validate structure. |
| Starter code | Partial | High; versioned per-language files and explicit stdin/function harness. |
| Run Code | Broken partial | High only through isolated gateway; free demo should disable/localize it. **Paid gate.** |
| Submit Code | Broken partial | High with immutable hidden suites, durable jobs and redaction. **Paid gate.** |
| Visible test cases | Reuse | High; examples only, author validation and safe output. |
| Hidden test cases | Broken partial | High after DTO/result redaction and isolated submit service. |
| Submission history | New | High; normalized immutable submissions/case results. |
| Difficulty and tags | Reuse | High; normalize tags and catalog filters/indexes. |
| Secure code execution | New | Feasible only as a separate no-network, quota-controlled runner. **Paid gate.** |
| Seed challenges | Partial | High; curated reviewed references/negative fixtures across initial languages. |
| Video progress | Partial | High; lesson/source-scoped intervals/revisions, server policy. |
| Lesson progress | Partial | High; authoritative policy events. |
| Module progress | Partial | High; derived/reconciled, never client-set. |
| Course progress | Partial | High; version-bound derived snapshots. |
| Resume playback | Reuse | High; adapt current overlay/player state to lesson IDs/revisions. |
| Cross-device synchronization | Partial | High; optimistic revision, retry/conflict and reconciliation. |

### Phase 2

| Capability | Current | Feasibility and required design |
|---|---|---|
| Provider roles/permissions | Partial | High after unified organization memberships and policy tests. |
| Provider dashboard | Reuse | High; replace client/prototype totals with scoped aggregates. |
| Course creation | Reuse | High; versioned drafts, validation, preview/publish. |
| Modules and lessons | Reuse | High; normalized ordering and immutable published versions. |
| Videos/external links | Partial | External links high/free; native upload needs processing/CDN. **Paid gate for native video.** |
| Notes and resources | Partial | High with sanitization/private object storage. |
| Download permissions | Broken partial | High with entitlement APIs and signed URLs; UI flags alone are insufficient. |
| Quizzes | Prototype concept | High; immutable question versions/attempts/server scoring. |
| Written answers | New | High; autosave plus manual grading/release policy. |
| Assignments | New | High; due dates, versions, rubrics and attempts. |
| ZIP/file submissions | New | High under strict scanning/quota/no-execution policy; storage cost grows. |
| Grading and feedback | New | High; queues, rubric audit, release/regrade. |
| Private courses | Broken partial | High with invitations and entitlement on catalog/detail/files. |
| Email invitations | New | High; hashed expiring tokens and transactional email. |
| Enrollment management | Partial | High; normalized state machine/roster/version binding. |
| Learner progress analytics | Partial | High; outbox events and reconciled aggregates, not raw embedded progress. |
| Manual QR-payment verification | New | Feasible as auditable human review; never client/AI-declared settlement. Human operations eventually paid. |

### Phase 3

| Capability | Current | Feasibility and required design |
|---|---|---|
| Profiles | Broken partial | High after minimal DTO allowlists and privacy policy. |
| Friend requests/following | Partial | Both feasible: follows plus accepted mutual friend connections; normalize relationships. |
| Posts | Reuse | High after audience/moderation lifecycle and pagination. |
| Text/images | Partial | High with sanitization/scanning/private originals/optimized delivery. |
| Video | Unsafe partial | External embeds practical; native social video requires transcode/CDN/moderation. **Paid gate.** |
| Comments | Partial | High; normalize bounded parent threads and policy. |
| Reactions | Partial | High; unique transactional records/counters. |
| Feed | Broken partial | High initially chronological/cursor/on-read; ranking/cache later. |
| Daily challenge activity | New | High from authoritative challenge events/schedule. |
| Challenge streaks | New | High with timezone/versioned event rules and rebuild. |
| Friend comparisons | New | High with opt-in/privacy/block controls. |
| Notifications | New | High for in-app/outbox; email/push scale costs. |
| Reporting | New | Mandatory before public UGC. |
| Blocking | Broken partial | High after symmetric transactional enforcement across all modules. |
| Moderation | New | Technically high; human staffing is the limiting paid/operational dependency. |
| Virtual credits/awards | Broken partial | High only as non-transferable immutable ledger with caps/reversals. |

### Phase 4

| Capability | Current | Feasibility and required design |
|---|---|---|
| Ideas | Partial | High; evolve Project into idea lifecycle/workspace. |
| Idea visibility | Partial | High through central policy. |
| Private/friends/public access | Partial | High after Phase 3 relationship/block policy. |
| Collaborators | New | High; explicit invite and owner/editor/commenter/viewer roles. |
| Notes | New | High as sanitized scoped artifacts. |
| Links | New | High with safe validation; omit server previews initially. |
| Images/files | New | High with private scanned object storage/quotas. |
| Comments | New | High by reusing normalized social discussion patterns. |
| Structured suggestions | New | High; typed state machine. |
| Upvotes/downvotes | Partial like concept | High with unique scoped votes/anti-abuse. |
| Update history | New | High as append-only meaningful updates/audit. |
| Repository links | New | High as validated external URLs; connector access is separate. |
| Demo links | New | High as validated external URLs/allowlisted embed policy. |
| Prototype submissions | New | High as versioned files/links; do not execute uploaded projects. |
| AI idea blueprints | New | High with schema/context consent/quotas/human review. **Paid API gate or deterministic fallback.** |

### Phase 5

| Capability | Current | Feasibility and required design |
|---|---|---|
| Browser practice environment | Reuse | High; current sandbox is the UX prototype. |
| Monaco or equivalent | Reuse | High; keep Monaco with model lifecycle/accessibility work. |
| File tree | New | High with normalized virtual paths. |
| Multiple files | New | High with workspace manifest/Monaco models/quotas. |
| Output panel | Reuse | High; escape/truncate/virtualize output. |
| Task instructions | Partial | High; immutable task DTO/panel. |
| Saved workspaces | Partial | High; revisions/snapshots/conflicts/retention. |
| Reset to starter | New | High; immutable starter and recoverable snapshot. |
| Automated validation | Partial | High through Phase 1 runner and task validators. **Paid hosted-runner gate.** |
| Secure execution | New | Reuse Phase 1 plane; never execute inside API/browser. **Paid gate.** |
| VS Code-compatible extension | New | High with stable HTTPS API and marketplace lifecycle. |
| Authentication from the extension | New | High via OAuth Authorization Code + PKCE/state and SecretStorage. |
| Idea retrieval | New | High through scoped APIs. |
| Blueprint generation | New | High with explicit context/quota/versioning. **Paid AI gate or fallback.** |
| Starter-project generation | New | High via deterministic manifest and preview. |
| Repository safety | New | High but mandatory: trust, path/protected-file rules, diff, transactional apply/rollback. |
| Progress synchronization | New | High with scoped idempotent events. |

### Phase 6

| Capability | Current | Feasibility and required design |
|---|---|---|
| Frontend deployment | New | High on static hosting; free-tier beta feasible. |
| Backend deployment | New | High; free cold-start demo only, paid always-on production. |
| Database deployment | New | High on managed PostgreSQL; tiny beta free, production paid. |
| Object storage | New | High; small beta free quotas, production lifecycle/billing. |
| Media delivery | New | High for images/docs; native video becomes paid CDN/transcode. |
| Code-execution infrastructure | New | High technically, never safely “serverless free” for production. **Paid gate.** |
| Email | New | High; small free quota, paid scale/reputation. |
| Background jobs | New | High; free scheduled beta limits, paid durable worker/queue. |
| Monitoring/logging | New | High; free short-retention beta, paid production retention/on-call. |
| Rate limiting | New | High; PostgreSQL/in-memory dev, Redis/gateway paid at scale. |
| Security headers | New | High and low cost; Phase 0/6 gate. |
| Backup/recovery | New | High; verified retention/restore is a production paid requirement. |
| CI/CD | New | High; free public/small private quotas, controlled paid growth. |
| Health checks | New | High; live/ready/startup/build endpoints. |
| Free-tier limitations | Known constraint | Explicit feature flags, cold-start/ephemeral/storage/build/quota messaging. |
| Production upgrade path | New | High; trigger-based topology/cost/capacity and go-live gates. |

## 12. Target architecture

Use a modular monolith for trusted product logic and one separately deployed untrusted execution plane:

```text
React web / VS Code extension
          |
     HTTPS /api/v1
          v
  API modular monolith --------> PostgreSQL
      |        |  \------------> private object storage + CDN/signed delivery
      |        \---------------> transactional email / external AI-video APIs
      v
  durable outbox/worker --------> notifications, analytics, scanning, scheduled jobs
      |
      | signed bounded execution jobs only
      v
 private execution gateway ----> isolated no-network runner pool
```

The API owns identity, organization policy, challenges, learning, LMS, social, moderation, Creative Space, workspace metadata and server-derived progress. The worker owns retryable asynchronous work. The runner has no database/object-store/application secrets or trusted network route. Use generated contracts between clients and API, explicit DTO allowlists, idempotency keys and transactional outbox events. Detailed component boundaries, flows, repository layout and migration sequence are in [ARCHITECTURE.md](./ARCHITECTURE.md).

## 13. Complete database plan

Migrate to PostgreSQL + Prisma in Phase 0C. Normalize identity, organization memberships, sessions, files, challenges/versions/tests/submissions, courses/versions/modules/lessons/enrollments/progress, assessments/assignments/grades, payment review, social graph/content/moderation, credits, ideas/collaboration, blueprints and workspaces. Use UUID primary keys; foreign keys; unique/check constraints; soft-retire/status fields where history matters; UTC timestamps; immutable audit/ledger/version rows; cursor-friendly indexes; and a transactional outbox.

Migration sequence: inventory/export Mongo records and file references; define mapping/reject reports; import identity/organizations/files; import challenges/courses/enrollments/progress/social/projects; validate counts, checksums, sampled ownership and derived totals; rehearse; freeze writes for final delta; switch through a controlled adapter; retain Mongo read-only for a time-bounded rollback window; then remove legacy write paths. No open-ended dual-write.

Every proposed table, invariant, index, retention decision and rollback gate is listed in [DATABASE_PLAN.md](./DATABASE_PLAN.md).

## 14. Complete API plan

All new endpoints live under `/api/v1`, use validated request/response schemas, consistent safe errors/correlation IDs, cursor pagination, idempotency for retried mutations, resource-oriented policy checks and explicit public/owner/manager DTOs. The complete catalog includes session/OAuth; organizations/staff; files; challenge authoring/run/submit/history; courses/content/progress; assessments/assignments/grading; invitations/enrollments/payment reviews; social graph/feed/notifications/credits/moderation; ideas/artifacts/suggestions/blueprints; workspaces/validation; extension OAuth/generation; admin and health operations.

Run/submit APIs create bounded jobs and never call an operating-system shell from the trusted API. File APIs presign/finalize private objects and never treat a public path as authorization. Full routes, scopes, contracts, error shapes, rate classes and API completion gates are in [API_PLAN.md](./API_PLAN.md).

## 15. Complete authorization model

Platform roles:

- `learner`: own profile, enrollments, progress, submissions, workspaces and allowed social/creative actions.
- `moderator`: assigned reports/cases and policy actions; no blanket provider/private-course access.
- `support` (optional): narrowly scoped audited account assistance, never hidden tests or arbitrary private content.
- `superadmin`: explicit high-risk platform operations with stronger authentication and audit.

Organization membership roles:

- `owner`: organization lifecycle, ownership transfer, staff and all provider resources.
- `admin`: staff except owner escalation, courses, enrollment, payment review and analytics.
- `instructor`: assigned course/content authoring, learner feedback and permitted analytics.
- `grader`: assigned submissions/rubrics/feedback only.
- `analyst`: read-only scoped aggregate analytics/export where authorized.

A person has one user identity and may simultaneously be a learner and member of multiple organizations. Every decision combines authenticated actor, active session, platform role, organization membership/status, resource ownership/assignment, enrollment/entitlement, audience/relationship/block state and moderation state. Client routes/buttons are convenience only. Detailed resource-action rules, DTO restrictions, extension scopes, step-up actions and test matrix are in [SECURITY_PLAN.md](./SECURITY_PLAN.md).

## 16. Complete implementation roadmap

| Ordered subphase | Stable item range | Outcome | Hard dependency |
|---|---|---|---|
| 0A Baseline/build/config | `P0A-S1`–`P0A-S6` | Reproducible Vite/TS workspace and dependency/config repair | None |
| 0B Identity/authorization | `P0B-S1`–`P0B-S6` | Unified user/org memberships and policy foundation | 0A |
| 0C Data/storage migration | `P0C-S1`–`P0C-S6` | PostgreSQL/Prisma, private files, controlled cutover | 0A–0B model decisions |
| 0D API/safety primitives | `P0D-S1`–`P0D-S6` | v1 schemas/errors/logs/security/outbox | 0A–0C |
| 0E Responsive cleanup | `P0E-S1`–`P0E-S6` | Adaptive accessible shell and removed abandoned paths/assets | 0A/0D contracts |
| 0F Tests/CI/release gate | `P0F-S1`–`P0F-S6` | Meaningful automated foundation and honest demo gate | 0A–0E |
| 1A Challenge content | `P1A-S1`–`P1A-S6` | Versioned statements/starters/tests/catalog/seeds | Phase 0 |
| 1B Secure execution | `P1B-S1`–`P1B-S6` | Isolated run/submit and durable history | 1A |
| 1C Progress | `P1C-S1`–`P1C-S6` | Video/lesson/module/course progress and sync | 0C, 1A/B events |
| 2A Provider tenancy | `P2A-S1`–`P2A-S5` | Staff roles, approval and dashboard | Phase 0 |
| 2B Course authoring | `P2B-S1`–`P2B-S6` | Versioned content/media/resources | 1C, 2A |
| 2C Assessment/grading | `P2C-S1`–`P2C-S6` | Quiz/written/assignment/file/grade workflows | 2B; 1B for code tasks |
| 2D Private/payment | `P2D-S1`–`P2D-S6` | Invites, enrollment and manual QR review | 2A–2B |
| 2E Analytics | `P2E-S1`–`P2E-S5` | Reconciled provider learning analytics | 1C, 2B–2D |
| 3A Profile/graph | `P3A-S1`–`P3A-S5` | Safe profiles/follows/friends/blocks | Phase 0 |
| 3B Social content/feed | `P3B-S1`–`P3B-S6` | Posts/media/comments/reactions/feed | 3A; 3D hooks |
| 3C Activity/rewards | `P3C-S1`–`P3C-S6` | Daily/streak/compare/notify/credit/awards | 1B/C, 3A/B |
| 3D Moderation | `P3D-S1`–`P3D-S6` | Reports/cases/actions/appeals | Phase 0; required before public UGC |
| 4A Idea workspace | `P4A-S1`–`P4A-S5` | Visibility and collaborators | 3A/3D |
| 4B Artifacts/collaboration | `P4B-S1`–`P4B-S6` | Notes/files/discussion/suggestions/votes/history/prototypes | 4A |
| 4C AI blueprints | `P4C-S1`–`P4C-S5` | Consent-first versioned structured blueprints | 4A/B, jobs |
| 5A Browser IDE | `P5A-S1`–`P5A-S6` | Multi-file Monaco practice UX | 1B/C |
| 5B Workspace validation | `P5B-S1`–`P5B-S6` | Save/sync/reset/validate/progress | 5A, 1B/C |
| 5C VS Code extension | `P5C-S1`–`P5C-S7` | PKCE auth, ideas/blueprints/generation, repo safety | 4C, 5A/B, stable API |
| 6A Production deployment | `P6A-S1`–`P6A-S7` | Reproducible service topology/health | Enabled feature contracts |
| 6B Hardening/operations | `P6B-S1`–`P6B-S7` | Observability/security/backup/CI/CD | 6A |
| 6C Paid go-live | `P6C-S1`–`P6C-S6` | Capacity/cost/DR/security/go-live signoff | 6A/B and beta evidence |

Each subphase contains all 15 required planning fields and individually trackable items in [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md).

## 17. Phase 0 details

Objective: turn an unsafe, drifting prototype into a reproducible foundation. Reuse the working React views, Express behavior and domain terminology, but freeze an evidence baseline before replacing infrastructure. Complete 0A through 0F: Vite/TypeScript/config/dependency repair; unified identity and organization authorization; PostgreSQL/Prisma/private files; versioned API/validation/errors/logging/security/outbox; responsive/accessibility cleanup; and tests/CI/observability/release gate.

Security focus: hidden/private DTO allowlists, session revocation, tenant/resource policy, sanitization, CORS/CSP/rate limits, file quarantine and removal of `vm2`. Deployment impact: dev/staging database and object storage begin here. Free beta feasible. Completion requires clean build/lint/type gates, meaningful unit/integration/E2E/security tests, migration rehearsal and zero known critical release blockers. Detailed requirements: `P0A-S1` through `P0F-S6`.

## 18. Phase 1 details

Objective: establish the first trustworthy product loop—discover a challenge, learn, run visible tests, submit hidden tests, retain history and synchronize progress. Reuse Monaco, challenge/video/progress UI and Piston protocol knowledge. Replace challenge serialization, starter contracts and direct execution.

Dependencies: all Phase 0 gates; content/versioning (1A) precedes execution (1B); authoritative progress (1C) consumes challenge/lesson events. Secure execution is a paid production dependency. The free fallback is reviewed examples plus local-run/download instructions with hosted Run/Submit disabled. Completion requires seed-reference validation, hidden leak/adversarial runner tests, durable idempotent submission history and cross-device progress reconciliation. Detailed requirements: `P1A-S1` through `P1C-S6`.

## 19. Phase 2 details

Objective: let approved providers create, publish, invite, teach, assess, grade, enroll and analyze learners. Reuse provider/course/enrollment screens and embedded course concepts, but move them to organization-scoped, versioned resources.

Order: roles/dashboard (2A), authoring/media/resources (2B), assessment/grading (2C), private enrollment/manual QR review (2D) and analytics (2E). External video and small resources can use free tiers; native video processing, large submissions, reliable email and growing analytics require paid capacity. Manual QR review is deliberately a human evidence workflow—only reviewer approval grants entitlement. Completion requires tenant isolation, immutable publication, answer/file security, audited grade/payment states and aggregate reconciliation. Detailed requirements: `P2A-S1` through `P2E-S5`.

## 20. Phase 3 details

Objective: replace the current privacy-leaking, in-memory social prototype with a moderated relationship/content/activity system. Both follows and friend connections are supported: one-way follows, private-account approval and optional explicit mutual connections.

Build safe profiles/graph (3A), normalized posts/feed/media (3B), authoritative activity/streak/notification/credit ledger (3C), and reports/moderation (3D). Although numbered after 3A, 3D policy/data hooks must be developed alongside 3B and must pass before public UGC release. Text/images/external video are the safe launch set; native video and staffed moderation are paid gates. Completion requires allowlist profile DTOs, privacy/block invariants, stable pagination, media security, replayable rewards and operational moderation/appeal tests. Detailed requirements: `P3A-S1` through `P3D-S6`.

## 21. Phase 4 details

Objective: evolve the minimal Project feature into a privacy-aware collaborative Idea workspace. Complete idea lifecycle/audience/collaborators (4A); notes/links/files/comments/suggestions/votes/history/repository/demo/prototypes (4B); and consent-first AI blueprints (4C).

Phase 4 depends on social relationship/block and moderation policies to make “friends-only” meaningful. The free fallback uses plain text, validated external links and small scanned files without previews; AI uses deterministic blueprint templates or bring-your-own key under explicit disclosure. Completion requires nested authorization, vote/concurrency and hostile URL/file tests, versioned artifact history and schema-validated human-reviewed AI output. Detailed requirements: `P4A-S1` through `P4C-S5`.

## 22. Phase 5 details

Objective: provide multi-file browser practice and a safe VS Code-compatible extension. Reuse Monaco and current sandbox layout, then add immutable task manifests/file tree/models/instructions/output (5A), revisioned saved workspaces/reset/validation/progress (5B), and OAuth PKCE extension workflows for ideas/blueprints/starters/sync (5C).

The browser and extension never execute untrusted code locally on behalf of the service without explicit user action; hosted validation uses the Phase 1 isolated plane. Repository generation is preview-first, denies overwrite by default, protects `.git`/secret files, normalizes paths and applies transactionally with rollback. A read-only download-to-empty-directory extension is the fallback. Completion requires OAuth/revocation, malicious-manifest/path, dirty-repository, rollback, cross-device and extension compatibility tests. Detailed requirements: `P5A-S1` through `P5C-S7`.

## 23. Phase 6 details

Objective: deploy and operate every enabled capability with explicit reliability, security and cost. Phase 6A provisions web/API/worker/PostgreSQL/object delivery/email/jobs/runner/health; 6B adds telemetry/SLOs/rate/security headers/scans/backup/restore/CI/CD; 6C converts measured beta demand into paid capacity, disaster recovery and go-live approval.

Deployment work begins as skeletons/health/config in Phase 0; Phase 6 is the production qualification, not the first deployment thought. Completion requires a clean staging deployment, migration/rollback and dependency-failure rehearsals, runner isolation, load/soak/alert drills, proven restores to declared RPO/RTO, protected artifact provenance, penetration/privacy review and named on-call ownership. Detailed requirements: `P6A-S1` through `P6C-S6`.

## 24. Free-deployment plan

The viable free plan is an explicitly constrained invite-only demo:

- Static React output on Cloudflare Pages or equivalent.
- Cold-start-capable demo API on a free service, with no local persistence assumptions.
- Small managed PostgreSQL free plan and S3-compatible free object quota for scanned images/documents.
- External YouTube/Vimeo links instead of uploaded/transcoded video.
- In-app notifications and tightly limited transactional email/jobs/monitoring.
- Hosted code execution **disabled**; show local-run/download instructions or a mock/reviewed-output learning mode.
- Feature flags and visible limitations for execution, native video, AI quota, email, file sizes, workspace retention and social enrollment caps.

Free tiers are good for preview/beta validation, not an availability promise. Exact provider limits, topology, configuration, CI and rollback procedure are maintained with official source links in [DEPLOYMENT_PLAN.md](./DEPLOYMENT_PLAN.md).

## 25. Paid-infrastructure upgrade path

Upgrade based on metrics, not merely phase number:

1. Always-on API and worker when cold starts or background delay violate learner/provider SLOs.
2. Managed PostgreSQL compute/storage/backups and connection pooling before free quota, performance or retention becomes unsafe.
3. Private object/CDN capacity, malware scanning and lifecycle before provider submissions/media scale.
4. Dedicated no-network runner gateway/pool before enabling public Run/Submit; scale through admission queues and per-user/org budgets.
5. Paid email/queue/monitoring with domain reputation, retries, longer retention and on-call alerts.
6. Native video transcode/CDN only after demand, rights/moderation and unit economics justify it.
7. Read replicas/warehouse/cache/search only when measured queries/volume demand them.
8. Formal cross-account/region backups, penetration testing, support/moderation staff and incident ownership before broad production go-live.

Every upgrade has a rollback/feature-shed path in `P6C-S1`–`P6C-S6` and [DEPLOYMENT_PLAN.md](./DEPLOYMENT_PLAN.md).

## 26. Rejected or redesigned approaches

- **Continue expanding embedded MongoDB documents:** rejected; relationship, entitlement, history and transaction requirements justify a Phase 0 relational migration.
- **Separate Company login/entity:** redesigned as one user identity plus organization memberships to avoid duplicate accounts and inconsistent authorization.
- **Microservices per feature:** rejected for current team/product maturity; use a modular monolith plus worker, separating only untrusted execution.
- **Execute through Express, `vm2`, `python-shell` or regex command blocking:** rejected; these do not form a security boundary.
- **Use a public Piston endpoint as product infrastructure:** rejected; no capacity/security/SLA ownership and hidden-test exposure risk.
- **Public local upload directory:** rejected; use private object records, scan/finalize and entitlement-aware signed delivery.
- **Client-calculated progress, points, certificates or payment success:** rejected; clients emit bounded evidence and server policies derive authoritative outcomes.
- **Publish current Space before moderation:** rejected; reporting/blocking/moderation operations are a release dependency.
- **Native social/provider video on the free launch:** redesigned to allowlisted external embeds until paid transcode/CDN/moderation exists.
- **AI blueprint directly writes/runs a repository:** rejected; structured output requires explicit review and Phase 5 safe manifest/apply logic.
- **Extension password/token copy-paste or filesystem token storage:** rejected; use browser OAuth PKCE and VS Code SecretStorage.
- **Uncontrolled dual-write migration:** rejected; rehearse, final-delta/freeze, controlled cutover and time-bounded read-only rollback.
- **Treat a passing build as readiness:** rejected; tests, security, migrations, recovery and operational evidence define completion.

## 27. Global risks

| Risk | Consequence | Primary mitigation/fallback |
|---|---|---|
| Scope breadth | Years of parallel half-features | Complete vertical subphases sequentially; enforce definitions of completion and feature flags. |
| Data migration | Identity/progress/social loss | Rehearsed mappings, reject reports, count/checksum/sample validation and read-only rollback. |
| Sandbox escape/abuse | Infrastructure compromise/cost | Dedicated no-network runner, no secrets, signed jobs, hard limits; disable hosted execution until proven. |
| Authorization/privacy drift | Cross-tenant/private data disclosure | Central policy/DTO allowlists and generated cross-role/IDOR matrices in CI. |
| UGC abuse and moderation load | User harm/legal/brand risk | Invite caps, report/block/quarantine/appeal tools, operational staffing; restrict media. |
| Upload/malware/storage abuse | Security and cost | Direct quarantine upload, signature/scan/limits, signed access and retention. |
| AI hallucination/injection/privacy | Unsafe plans/data leakage/cost | Consent allowlists, redaction, schema validation, budget, human review and deterministic fallback. |
| Provider/payment disputes | Entitlement/revenue/support errors | Audited state machine, human QR review, proof privacy and eventual hosted payment provider. |
| Free-tier suspension/cold starts | Poor reliability/data assumptions | Honest demo labeling, stateless design, provider limit alerts and trigger-based paid upgrades. |
| Dependency/toolchain debt | Vulnerability/build failure | Vite/TS migration, remove unused packages, lock/scanning policy and update cadence. |
| Copyright/media rights | Takedowns/cost | Remove questionable bundled media, provider attestations, takedown process and external embeds. |
| Operational staffing | Incidents/moderation/payment delays | Limit launch population/features until named owners and SLO/runbooks exist. |

## 28. Recommended execution order

1. Freeze evidence and complete `P0A`–`P0F`; do not build new product features on current identity/data/file foundations.
2. Deliver `P1A`, then prove `P1B` runner isolation before enabling hosted execution, then complete `P1C` authoritative progress.
3. Build provider tenancy `P2A`, authoring `P2B`, then `P2C`/`P2D`; aggregate analytics `P2E` only after source events stabilize.
4. Build `P3A` and moderation foundation `P3D` together; release `P3B` only when report/block/quarantine paths pass; add `P3C` after authoritative learning events exist.
5. Build `P4A`/`P4B` on the shared visibility/moderation/file primitives, then add optional AI `P4C` with the deterministic fallback retained.
6. Build browser IDE `P5A`/`P5B` on the already proven execution/progress contracts; create extension `P5C` last so its public API and repository-safety contract are stable.
7. Maintain deployable staging/health/config from Phase 0, then complete `P6A`/`P6B`; use beta telemetry to execute `P6C` paid upgrades and go-live review.

The only justified ordering changes from the requested high-level sequence are: authorization/data/object-storage foundations move into Phase 0; secure execution is proven in Phase 1 before browser IDE/extension validation; moderation is a parallel prerequisite to public social/Creative content; and deployment scaffolding starts in Phase 0 even though final production qualification remains Phase 6. These are dependency corrections, not omitted phases.
