# CodeWithMee API Plan

**Status:** Target API contract  
**Base path:** `/api/v1`  
**Primary format:** JSON over HTTPS; direct object uploads use presigned HTTPS requests

## 1. Contract rules

- Version every public web/extension endpoint under `/api/v1`. Health endpoints remain `/health/live`, `/health/ready`, and `/health/dependencies`.
- Generate and validate an OpenAPI 3.1 document in CI. Generate TypeScript client types from it; do not hand-maintain duplicate request interfaces.
- Validate params, query, headers, and body at the route boundary with strict schemas. Unknown mutation fields are rejected.
- Use resource-specific response DTOs. ORM/Mongoose rows are never serialized directly.
- Error responses use `application/problem+json` with `type`, `title`, `status`, `code`, `detail`, `instance`, `correlationId`, and optional field errors.
- Use cursor pagination (`limit` capped at 50, opaque `cursor`) for feeds, notifications, submissions, audit events, and administrative queues.
- Mutations that can create duplicate financial, enrollment, execution, grading, invitation, or generation effects require an `Idempotency-Key` header.
- `ETag`/revision checks protect collaborative or frequently edited drafts. Conflicting updates return `409` with the current revision.
- Long-running operations return `202 Accepted` plus job/status URLs. Execution may use short polling or SSE; email, AI, media scan, and analytics never block the initiating request.
- Deprecations appear in OpenAPI and response headers with a removal version/date. Breaking changes require `/api/v2` or a negotiated contract version.

## 2. Authentication and authorization contract

Web clients send short-lived module-memory access tokens in `Authorization: Bearer`. Refresh uses a secure HttpOnly cookie. P0B-S5 removed `x-auth-token` and persistent browser token storage; P0D-S6 deleted the server recovery bridge and the `JWT_SECRET` alias, so Bearer/cookie sessions are the only authentication contract in every environment.

Web refresh/logout requests also send the readable same-site CSRF cookie value in `X-CSRF-Token`; the server compares it with the session-bound hash and requires an exact trusted `Origin`. Login/register/reset mutations require the trusted origin as login-CSRF defense. Production cookies are `Secure`, refresh is `HttpOnly; SameSite=Lax`, and no refresh/reset/verification value appears in a response body or log.

Every protected handler calls a domain policy with the current user, organization context (when present), target resource, and action. A hidden UI control is not authorization.

The access-token contract contains only issuer, audience, user ID, session ID, issued-at and expiry claims. Current account status, email verification, platform role, membership and course assignment are loaded server-side. Course assignments narrow an active same-tenant membership and never elevate it; platform administration does not imply private tenant access. [ADR 0001](adr/0001-unified-identity-authorization.md) is normative for these semantics.

Common scopes/actions:

- `profile:read`, `profile:write`
- `challenges:read`, `challenges:author`, `submissions:create`, `submissions:read:self`
- `courses:read`, `courses:author`, `courses:publish`, `courses:grade`, `courses:analytics`
- `social:read`, `social:write`, `moderation:review`
- `ideas:read`, `ideas:write`, `blueprints:create`
- `workspaces:read`, `workspaces:write`, `repositories:export`
- `organizations:manage`, `platform:admin`

Organization endpoints include `/organizations/{organizationId}` and never infer authorization merely from a company-shaped JWT.

## 3. Endpoint catalog

The catalog is the target surface; individual response fields are finalized in OpenAPI during the referenced implementation item.

### 3.1 Identity and sessions

| Method/path                       | Purpose                               | Access and important behavior                      |
| --------------------------------- | ------------------------------------- | -------------------------------------------------- |
| `POST /auth/register`             | local user registration               | public, rate-limited, email verification required  |
| `POST /auth/login`                | local login                           | public, generic failure, lockout/rate-limit policy |
| `GET /auth/google/start`          | start Google auth-code flow           | public, state/nonce/PKCE                           |
| `GET /auth/google/callback`       | verify Google callback                | public callback, allowlisted redirect              |
| `POST /auth/refresh`              | rotate session                        | refresh cookie + origin/CSRF policy                |
| `POST /auth/logout`               | revoke current session                | authenticated/idempotent                           |
| `POST /auth/logout-all`           | revoke all sessions                   | authenticated + recent-auth check                  |
| `POST /auth/email/verify/request` | send verification                     | authenticated/rate-limited                         |
| `POST /auth/email/verify/confirm` | consume verification token            | public token, single use                           |
| `POST /auth/password/forgot`      | send reset message                    | public, non-enumerating                            |
| `POST /auth/password/reset`       | consume reset and revoke sessions     | public token, single use                           |
| `GET /me`                         | current safe identity/profile summary | authenticated                                      |
| `PATCH /me`                       | allowlisted profile fields            | authenticated + revision                           |
| `GET /me/sessions`                | list devices/sessions                 | authenticated                                      |
| `DELETE /me/sessions/{id}`        | revoke a session                      | owner/recent auth                                  |

### 3.2 Extension OAuth/PKCE

| Method/path                               | Purpose                       | Access                                                   |
| ----------------------------------------- | ----------------------------- | -------------------------------------------------------- |
| `GET /oauth/authorize`                    | browser consent for extension | authenticated browser, registered client/redirect/scopes |
| `POST /oauth/token`                       | exchange code/refresh token   | PKCE verifier, one-time code or refresh grant            |
| `POST /oauth/revoke`                      | revoke extension token family | token/client authenticated                               |
| `GET /me/extension-installations`         | list authorized installs      | owner                                                    |
| `DELETE /me/extension-installations/{id}` | revoke installation           | owner                                                    |

### 3.3 Organizations/providers

P0B-S3 implements the following compatibility surface under `/api/v1`: authenticated `GET /organizations`, create/read/update, member list/change/remove, invitation create/accept, verification submission, and the recent-auth superadmin review queue/decision endpoints. All writes require an exact trusted `Origin`; access tokens are revalidated against current session/user state. Invitation responses never include the raw token or HMAC hash. The Phase 0C repository swap keeps these service/DTO semantics while replacing compensation with database transactions.

| Method/path                                        | Purpose                                    | Access                                         |
| -------------------------------------------------- | ------------------------------------------ | ---------------------------------------------- |
| `GET /organizations`                               | current user's active provider memberships | authenticated user; private DTO scoped to self |
| `POST /organizations`                              | create provider draft                      | verified user; creator becomes owner           |
| `GET /organizations/{id}`                          | provider public/private DTO                | policy-filtered                                |
| `PATCH /organizations/{id}`                        | update provider profile                    | owner/admin                                    |
| `POST /organizations/{id}/verification`            | submit verification evidence               | owner/admin                                    |
| `GET /organizations/{id}/members`                  | list members                               | owner/admin                                    |
| `POST /organizations/{id}/invitations`             | invite staff                               | owner/admin; cannot grant above actor          |
| `POST /organization-invitations/{token}/accept`    | accept staff invite                        | matching verified user                         |
| `PATCH /organizations/{id}/members/{userId}`       | change member role/status                  | owner/admin hierarchy rules                    |
| `DELETE /organizations/{id}/members/{userId}`      | remove membership                          | owner/admin; last-owner invariant              |
| `GET /admin/provider-verifications`                | provider review queue                      | superadmin + recent authentication             |
| `POST /admin/provider-verifications/{id}/decision` | approve/reject provider                    | superadmin + recent authentication             |

### 3.4 Challenge catalog, authoring, and submissions

| Method/path                                  | Purpose                                              | Access                                                      |
| -------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------- |
| `GET /challenges`                            | searchable/filterable catalog                        | learner-safe DTO; no hidden/reference data                  |
| `GET /challenges/{slug}`                     | challenge statement/version/starter/visible examples | learner-safe DTO                                            |
| `POST /challenges`                           | create draft                                         | platform author or authorized provider staff                |
| `PATCH /challenges/{id}`                     | edit draft metadata                                  | owner/manager + revision                                    |
| `POST /challenges/{id}/versions`             | create new draft version                             | manager                                                     |
| `PUT /challenge-versions/{id}/starter-files` | replace validated starter manifest                   | manager                                                     |
| `PUT /challenge-versions/{id}/test-cases`    | manage visible/hidden cases                          | manager; privileged response                                |
| `POST /challenge-versions/{id}/publish`      | validate/freeze version                              | manager/reviewer                                            |
| `POST /challenges/{id}/runs`                 | visible/custom run                                   | authenticated, execution quota, idempotent                  |
| `POST /challenges/{id}/submissions`          | hidden test submission                               | authenticated, execution quota, idempotent                  |
| `GET /execution-jobs/{id}`                   | redacted job status/result                           | owner or grader                                             |
| `GET /challenges/{id}/submissions`           | current user's history                               | self; provider grader gets course-scoped view               |
| `GET /submissions/{id}`                      | submission detail                                    | self/authorized grader; hidden results redacted for learner |
| `GET /me/challenge-progress`                 | solved/attempted summary and streak inputs           | self                                                        |
| `POST /challenges/{id}/save`                 | save/unsave                                          | authenticated, idempotent state request                     |

### 3.5 Course authoring and publishing

| Method/path                                    | Purpose                               | Access                                        |
| ---------------------------------------------- | ------------------------------------- | --------------------------------------------- |
| `GET /courses`                                 | public/entitled catalog               | policy-filtered, cursor/search filters        |
| `GET /courses/{slug}`                          | catalog detail or enrolled content    | response tier based on entitlement            |
| `POST /organizations/{orgId}/courses`          | create course draft                   | instructor/admin in approved provider         |
| `GET /organizations/{orgId}/courses`           | provider course management list       | staff permission                              |
| `PATCH /courses/{id}`                          | update course draft/settings          | authorized course staff + revision            |
| `POST /courses/{id}/modules`                   | add module                            | course author                                 |
| `PATCH /course-modules/{id}`                   | edit/reorder module                   | course author + revision                      |
| `DELETE /course-modules/{id}`                  | remove draft module                   | course author; published versions immutable   |
| `POST /course-modules/{id}/lessons`            | add lesson                            | course author                                 |
| `PATCH /lessons/{id}`                          | edit/reorder lesson                   | course author + revision                      |
| `DELETE /lessons/{id}`                         | remove draft lesson                   | course author                                 |
| `POST /courses/{id}/publish`                   | validate and create published version | publish permission; idempotent                |
| `POST /courses/{id}/versions/{version}/retire` | retire catalog version                | owner/admin; enrolled access policy preserved |

### 3.6 Video, notes, resources, and files

| Method/path                        | Purpose                         | Access                            |
| ---------------------------------- | ------------------------------- | --------------------------------- |
| `POST /files/upload-intents`       | authorize direct upload         | purpose-specific permission/quota |
| `POST /files/{id}/complete`        | confirm object and start scan   | uploader; idempotent              |
| `GET /files/{id}`                  | file metadata                   | owner/entitlement/policy          |
| `POST /files/{id}/download-url`    | short-lived authorized download | policy + download flag            |
| `DELETE /files/{id}`               | detach/delete when safe         | owner/policy, retention-aware     |
| `POST /lessons/{id}/video-sources` | attach validated source/upload  | course author                     |
| `POST /lessons/{id}/resources`     | attach note/resource/link       | course author                     |
| `PATCH /lesson-resources/{id}`     | update label/download policy    | course author                     |

### 3.7 Enrollment, invitations, payments, and progress

| Method/path                                               | Purpose                         | Access                                              |
| --------------------------------------------------------- | ------------------------------- | --------------------------------------------------- |
| `POST /courses/{id}/enrollments`                          | enroll in free/entitled course  | learner; rejects paid-without-approved-order        |
| `GET /me/enrollments`                                     | learner course list             | self                                                |
| `GET /enrollments/{id}`                                   | course/version/progress summary | learner or authorized staff                         |
| `POST /courses/{id}/invitations`                          | invite learner(s)               | provider enrollment manager; email job              |
| `POST /course-invitations/{token}/accept`                 | accept invitation               | matching user/email                                 |
| `GET /courses/{id}/enrollments`                           | provider roster                 | enrollment/analytics permission                     |
| `PATCH /enrollments/{id}`                                 | suspend/restore/unenroll        | provider manager with audit                         |
| `POST /courses/{id}/payment-orders`                       | create manual payment order     | learner; price snapshot                             |
| `POST /payment-orders/{id}/proofs`                        | submit proof file/reference     | order owner; scanned file                           |
| `GET /organizations/{orgId}/payment-orders`               | review queue                    | payment reviewer                                    |
| `POST /payment-orders/{id}/reviews`                       | approve/reject                  | reviewer; idempotent transaction creates enrollment |
| `PUT /enrollments/{id}/lessons/{lessonId}/video-progress` | position/watched update         | enrollment owner; revision/range checks             |
| `POST /enrollments/{id}/lessons/{lessonId}/complete`      | request completion evaluation   | enrollment owner; server derives result             |
| `GET /enrollments/{id}/progress`                          | lesson/module/course progress   | learner/staff policy                                |

### 3.8 Quizzes, written answers, assignments, grading

| Method/path                                    | Purpose                            | Access                                     |
| ---------------------------------------------- | ---------------------------------- | ------------------------------------------ |
| `PUT /lessons/{id}/quiz`                       | create/update draft quiz           | course author                              |
| `POST /quizzes/{id}/attempts`                  | start immutable attempt            | enrolled learner; attempt limits           |
| `PUT /quiz-attempts/{id}/answers/{questionId}` | autosave answer                    | attempt owner while open                   |
| `POST /quiz-attempts/{id}/submit`              | finalize and auto-grade safe types | attempt owner; idempotent                  |
| `GET /quiz-attempts/{id}`                      | result/feedback DTO                | owner/grader; correct answers policy-based |
| `PUT /lessons/{id}/assignment`                 | create/update assignment           | course author                              |
| `POST /assignments/{id}/submissions`           | create draft/revision              | enrolled learner                           |
| `POST /assignment-submissions/{id}/files`      | attach ready files/ZIP             | owner, file policy                         |
| `POST /assignment-submissions/{id}/submit`     | finalize revision                  | owner, due/version rules                   |
| `GET /courses/{id}/grading-queue`              | pending written/assignment work    | grader                                     |
| `POST /quiz-answers/{id}/grade`                | grade written answer               | grader + rubric/audit                      |
| `POST /assignment-submissions/{id}/grades`     | grade/regrade with feedback        | grader + audit                             |
| `GET /enrollments/{id}/grades`                 | learner gradebook                  | learner or staff policy                    |

### 3.9 Social Space

| Method/path                          | Purpose                             | Access                                          |
| ------------------------------------ | ----------------------------------- | ----------------------------------------------- |
| `GET /profiles/{username}`           | policy-filtered profile             | authenticated initially; public later by policy |
| `PATCH /me/profile`                  | edit bio/links/privacy              | self                                            |
| `POST /profiles/{userId}/follow`     | follow or request                   | user; block/privacy checks                      |
| `DELETE /profiles/{userId}/follow`   | cancel/unfollow                     | user                                            |
| `POST /follow-requests/{id}/accept`  | accept request                      | target user                                     |
| `POST /follow-requests/{id}/reject`  | reject request                      | target user                                     |
| `POST /profiles/{userId}/block`      | create block and remove graph edges | user, transaction                               |
| `DELETE /profiles/{userId}/block`    | unblock                             | user                                            |
| `GET /feed`                          | personalized/following feed         | authenticated, cursor, privacy/block in query   |
| `POST /posts`                        | create text post                    | active user, rate-limited                       |
| `PATCH /posts/{id}`                  | edit within policy/window           | author                                          |
| `DELETE /posts/{id}`                 | soft delete                         | author/moderator                                |
| `POST /posts/{id}/media`             | attach ready image/video            | author, media policy                            |
| `POST /targets/{type}/{id}/comments` | comment/reply                       | active authorized user                          |
| `PATCH /comments/{id}`               | edit comment                        | author/policy                                   |
| `DELETE /comments/{id}`              | soft delete                         | author/target owner/moderator policy            |
| `PUT /targets/{type}/{id}/reaction`  | set/remove reaction                 | active user, idempotent desired state           |
| `PUT /targets/{type}/{id}/saved`     | save/unsave                         | user                                            |
| `GET /daily-activity`                | challenge activity/streak           | self/friend-comparison policy                   |
| `GET /comparisons/{userId}`          | friend comparison                   | accepted relationship + privacy                 |
| `GET /leaderboards`                  | scoped leaderboard                  | privacy-aware, precomputed/cached               |

### 3.10 Notifications, credits, and moderation

| Method/path                              | Purpose                      | Access                              |
| ---------------------------------------- | ---------------------------- | ----------------------------------- |
| `GET /notifications`                     | paginated notification inbox | self                                |
| `POST /notifications/read`               | mark IDs/read-all            | self                                |
| `GET /me/notification-preferences`       | get preferences              | self                                |
| `PUT /me/notification-preferences`       | update preferences           | self                                |
| `GET /me/credits`                        | balance and ledger page      | self                                |
| `GET /awards/catalog`                    | active virtual awards        | authenticated                       |
| `POST /targets/{type}/{id}/awards`       | spend credits/give award     | active user; atomic ledger          |
| `POST /reports`                          | report content/user          | authenticated, private/rate-limited |
| `GET /moderation/cases`                  | case queue                   | moderator/superadmin                |
| `GET /moderation/cases/{id}`             | case evidence                | assigned/authorized moderator       |
| `POST /moderation/cases/{id}/actions`    | warn/hide/suspend/ban        | permission + reason + audit         |
| `POST /moderation/actions/{id}/appeals`  | appeal                       | affected user                       |
| `POST /moderation/appeals/{id}/decision` | decide appeal                | independent authorized reviewer     |

### 3.11 Creative Space

| Method/path                                | Purpose                               | Access                                  |
| ------------------------------------------ | ------------------------------------- | --------------------------------------- |
| `GET /ideas`                               | visible ideas/search                  | policy-filtered cursor results          |
| `POST /ideas`                              | create idea                           | active user                             |
| `GET /ideas/{id}`                          | idea with entitled children summary   | visibility/collaborator policy          |
| `PATCH /ideas/{id}`                        | edit idea/visibility                  | owner/editor + revision                 |
| `DELETE /ideas/{id}`                       | soft delete/archive                   | owner                                   |
| `POST /ideas/{id}/collaborators`           | invite collaborator                   | owner/editor policy                     |
| `PATCH /ideas/{id}/collaborators/{userId}` | role/acceptance changes               | owner; role ceiling                     |
| `POST /ideas/{id}/notes`                   | add note                              | collaborator role                       |
| `POST /ideas/{id}/links`                   | add validated reference/repo/demo URL | editor                                  |
| `POST /ideas/{id}/files`                   | attach ready file/image               | editor, quota                           |
| `POST /ideas/{id}/suggestions`             | structured suggestion                 | visible commenter/collaborator          |
| `PATCH /suggestions/{id}`                  | accept/reject/implement               | idea editor; audit/history              |
| `PUT /suggestions/{id}/vote`               | up/down/remove                        | entitled user, one vote                 |
| `POST /ideas/{id}/updates`                 | append progress update                | editor                                  |
| `POST /ideas/{id}/prototypes`              | submit repo/demo/file prototype       | collaborator policy                     |
| `POST /ideas/{id}/blueprint-jobs`          | request AI blueprint                  | owner/editor, consent/quota/idempotency |
| `GET /blueprint-jobs/{id}`                 | generation status                     | requester/idea collaborator             |
| `GET /blueprints/{id}`                     | validated generated draft             | idea access policy                      |

### 3.12 Browser IDE, workspaces, and extension operations

| Method/path                             | Purpose                                  | Access                                    |
| --------------------------------------- | ---------------------------------------- | ----------------------------------------- |
| `GET /practice-tasks/{id}`              | task instructions/template manifest      | entitled learner                          |
| `POST /practice-tasks/{id}/workspaces`  | create/resettable workspace              | entitled learner, quota                   |
| `GET /workspaces`                       | list saved workspaces                    | owner                                     |
| `GET /workspaces/{id}`                  | workspace manifest/files                 | owner/collaborator policy                 |
| `PUT /workspaces/{id}/files/{path}`     | create/update text file                  | owner, normalized path, revision          |
| `DELETE /workspaces/{id}/files/{path}`  | delete file                              | owner + revision                          |
| `POST /workspaces/{id}/snapshots`       | manual/autosave snapshot                 | owner, quota/idempotency                  |
| `POST /workspaces/{id}/reset`           | reset to starter as new revision         | owner; non-destructive history            |
| `POST /workspaces/{id}/runs`            | execute current snapshot                 | owner; runner quota                       |
| `POST /workspaces/{id}/validations`     | run private/public validators            | owner; redacted result                    |
| `GET /workspaces/{id}/events`           | SSE job/progress updates                 | owner                                     |
| `GET /extension/ideas`                  | retrieve accessible ideas                | scoped extension token                    |
| `POST /extension/ideas/{id}/blueprints` | request/retrieve blueprint               | scoped token + idea policy                |
| `POST /extension/starter-projects`      | generate safe manifest/archive/workspace | scoped token, job/quota                   |
| `POST /extension/workspaces/{id}/sync`  | manifest/revision sync                   | scoped token, conflict response           |
| `POST /extension/repository-exports`    | create reviewed export plan              | scoped token + explicit user confirmation |

### 3.13 Administration and operations

| Method/path                                        | Purpose                      | Access                                   |
| -------------------------------------------------- | ---------------------------- | ---------------------------------------- |
| `GET /admin/users`                                 | paginated user management    | moderator/superadmin, field-minimized    |
| `PATCH /admin/users/{id}/status`                   | suspend/restore              | role hierarchy + audit                   |
| `PATCH /admin/users/{id}/platform-role`            | role change                  | superadmin, last-admin/self rules        |
| `GET /admin/provider-verifications`                | provider review queue        | authorized admin                         |
| `POST /admin/provider-verifications/{id}/decision` | approve/reject               | authorized admin + evidence/audit        |
| `GET /admin/audit-events`                          | searchable audit trail       | restricted superadmin/auditor            |
| `GET /health/live`                                 | process liveness             | public minimal response                  |
| `GET /health/ready`                                | readiness to serve           | infrastructure/load balancer; no secrets |
| `GET /health/dependencies`                         | privileged dependency detail | internal/admin only                      |

P0B-S6 implements the user list, status, platform-role and audit-event endpoints under `/api/v1`, plus `POST /organizations/{id}/ownership-transfer`. Mutations require a 12-500 character reason, current optimistic revision, recent authentication and exact trusted origin; unknown fields are rejected. Responses include the new revision and redacted audit event. Target sessions are revoked with role/non-active status changes. The bootstrap is deliberately absent from HTTP and runs once through the operator CLI. Legacy admin list/ban/role/delete handlers return `410` replacements.

P0C-S1 changes no HTTP contract and deliberately does not expose Prisma rows. It fixes the relational persistence shape beneath the existing identity/organization/authority service interfaces; P0C-S4 swaps repositories only after source inventory and normalized import evidence. Future APIs continue to use explicit DTOs and opaque UUIDs rather than generated database types.

## 4. Response redaction rules

- Challenge learner DTOs exclude reference solutions, checker source/config, hidden case input/output, internal limits beyond safe published limits, and other users' source.
- Public/profile DTOs exclude email, auth method, reset fields, sessions, notes, conversations, private roadmaps, blocked users, invitations, and moderation internals.
- Course catalog DTOs exclude unpublished content and assessments. Enrolled content excludes answer keys/rubric-private fields until policy permits.
- Submission learner DTOs show hidden-case count and verdict categories, not hidden input/expected output or internal diagnostics.
- File DTOs never expose storage credentials or raw private keys; download URLs are short-lived and audience-bound where supported.
- AI job DTOs exclude provider credentials, raw safety metadata that enables bypass, and other users' retrieved context.
- Administrative list DTOs are narrower than detailed case DTOs and require explicit reason/audit for sensitive access where appropriate.

## 5. Rate-limit classes

| Class              | Examples                          | Initial policy direction                                           |
| ------------------ | --------------------------------- | ------------------------------------------------------------------ |
| Authentication     | login, reset, verify              | per IP + normalized account; progressive delay and abuse telemetry |
| Expensive external | AI, YouTube lookup, email         | per user/org and global daily budget                               |
| Execution          | run, submit, workspace validation | concurrent + rolling CPU/job quota per user/org/IP                 |
| Upload             | upload intent/complete            | count and bytes per purpose/user/org/day                           |
| Social write       | post/comment/react/follow/report  | burst plus sustained limit; reports stricter                       |
| Read               | feed/search/profile               | per token/IP with cache and cursor caps                            |
| Admin              | moderation/payment/role changes   | low rate, recent auth, immutable audit                             |

Exact numbers are configuration, measured in load tests, and stricter on free infrastructure.

## 6. API testing and completion criteria

- OpenAPI lint and breaking-change checks pass in CI.
- Every route has schema, authentication classification, authorization policy, response DTO, rate-limit class, and audit classification.
- Contract tests assert that hidden tests, secrets, private profile fields, answer keys, payment evidence, and moderation data never leak.
- Integration tests cover ownership and cross-tenant IDOR attempts for every resource family.
- Idempotency tests repeat execution, payment approval, enrollment, grading, email invitation, award, and AI generation requests.
- Pagination tests prove stable, duplicate-free cursor traversal under concurrent inserts.
- The authentication migration is complete: client and server source cannot use old unversioned credentials, persistent auth-token storage, `x-auth-token`, `LEGACY_AUTH_COMPATIBILITY`, or a `JWT_SECRET` alias.

P0B-S4 server cutover note: unversioned `/api/auth/*` credential routes return `410 legacy_auth_retired`, legacy Company-backed provider-course routes return `410` with the target organization-course path, and destructive/role-changing legacy admin handlers point to the audited `/api/v1` workflow. Remaining protected feature handlers accept only the current `/api/v1` Bearer principal through one middleware. P0B-S5 completed the browser cutover, and P0D-S6 deleted the final header/JWT recovery path.

Repository evidence requires feature-route retirement to follow feature replacement rather than precede it. `/api/code`, `/api/ai`, `/api/youtube`, `/api/roadmap`, learner `/api/user`, `/api/challenges`, and learner `/api/courses` are Phase 1 owners; provider course routes are Phase 2; `/api/space` social routes are Phase 3; idea/project portions are Phase 4. `/api/auth` and legacy `/api/admin` remain deterministic `410` tombstones. `PERSISTENCE_LEGACY_API_MODE=disabled` can retire the entire set for an atomic PostgreSQL cutover, but the default compatibility client cannot lose an active route until its versioned replacement passes acceptance.

P0C-S2 adds no HTTP endpoint. Source inventory, encrypted export and import dry-run remain operator-only CLI operations so browser/API principals can never request source-database traversal or obtain migration artifacts. Future P0C-S4 import operations must remain offline jobs behind database safety approval and write `import_runs` provenance; they must not become public or general admin routes.

P0C-S3 implements the first `/api/v1/files` slice: `POST /upload-intents`, `GET /{fileId}`, `POST /{fileId}/complete`, `POST /{fileId}/download-url`, `PATCH /{fileId}/visibility`, and `DELETE /{fileId}`. Unsafe requests require current Bearer authentication plus the trusted-origin gate. The intent binds byte size, declared MIME, SHA-256, file ID and checksum metadata into a short private PUT; completion performs HEAD verification and queues scanning. Downloads are short-lived and exist only for ready, clean records after a fresh owner/organization policy check. Owner-scope failures return the same `404 file_not_found`; DTOs never contain bucket, key, checksum or quarantine internals.

The implemented purpose catalog is deliberately narrower than the final API: safe image/document/text resource, note, idea, social and avatar types are supported; direct video and archive upload remain rejected. Organization reads require an active membership and organization writes require active owner/admin authority. Additional course entitlement, collaborator, moderation and public-media policies are added by their owning phases without weakening this file boundary. Missing storage/database/scanner produces an explicit `503`; no route falls back to production local disk.

## 14. P0C-S5 runtime API behavior

P0C-S5 adds no public migration, parity, flag or rollback endpoint. Those operations remain private CLI jobs with explicit environment/database/dataset/report/generation approvals. Their stdout is limited to checksums, domains, environment and outcome; report files contain aggregate safe metadata only.

The versioned `/api/v1` identity, organization, authority and file contracts do not change when their repository store changes. DTOs still omit password/token hashes and mutable token authority; authorization reloads current PostgreSQL state. If the atomic core PostgreSQL cutover is selected, `PERSISTENCE_LEGACY_API_MODE=disabled` is mandatory and every old `/api/auth`, `/api/user`, `/api/roadmap`, `/api/challenges`, `/api/courses`, `/api/space`, `/api/admin`, `/api/ai`, `/api/youtube` and `/api/code` path returns `410 { error: { code: "legacy_api_disabled_for_cutover" } }`. This is an explicit maintenance/compatibility response, not a fallback to mixed stores.

No parity details are exposed by health endpoints. Phase 6 may add a restricted readiness summary, but it may report only configured/verified state and aggregate codes—never operational hashes, report contents, source identifiers or a way to mutate authority.

P0C-S4 adds no HTTP route. Encrypted source import stays an offline operator command because source traversal, raw migration records and cutover controls are never browser/admin API capabilities. The command writes explicit import provenance and returns only counts, checksums, warning codes and a run UUID. P0C-S5 deliberately keeps readiness/parity offline; any later Phase 6 operations summary must remain restricted and redacted, with no snapshot paths, source IDs, exception values or general migration endpoint.

## 15. Recovery operations are not HTTP APIs

P0C-S6 adds no browser or public API. Backup, restore, file reconciliation and legacy-removal assessment are operator/CI modules only. They have no Express route, cannot consume an end-user token, and return aggregate hashes/counts rather than records, object keys or paths. Future administrative recovery UX may display signed evidence, but actual export/restore/deletion remains an isolated least-privilege job with exact target approval.

## 16. P0D-S1 executable v1 contract

The implemented API now has one executable contract registry in `server/modules/api`. It publishes OpenAPI 3.1.1 at `GET /api/v1/openapi.json` and exports the same immutable document to `docs/openapi/codewithmee-v1.openapi.json`. The document contains 37 implemented operations over 33 paths; roadmap-only endpoints remain in this plan and are intentionally absent from the live document.

Every identity, organization, authority and file route is bound to its stable `operationId` and the same JSON Schema 2020-12 request object used by the OpenAPI document. The boundary is non-coercing, rejects unknown properties recursively, caps errors at 20 and returns only codes plus JSON pointers. Domain services retain their semantic validation as defense in depth. Response component schemas describe explicit DTO allowlists; ownership-transfer output was narrowed instead of publishing repository records.

Cross-module conventions are executable:

- cursors are versioned, HMAC-authenticated base64url envelopes with bounded identifier and sort anchors;
- optimistic revisions use strong `"rev-N"` ETags and `If-Match`, while existing body revisions remain a compatibility bridge until their route migrations;
- idempotency keys are 16-128 character opaque header values; durable replay semantics belong to P0D-S6;
- errors use `application/problem+json` with a stable public type, code, status and title plus optional pointer-only validation errors.

No schema, credential, hash, storage key, provider error or hidden roadmap operation is exposed by the contract.

## 17. P0D-S2 HTTP lifecycle and health contract

All Express requests now receive a bounded correlation ID before CORS or parsing. A valid `X-Request-Id` is preserved; malformed values are replaced with a UUID. The same ID is returned in `X-Request-Id`, problem details and one completion/failure log record. Route templates are logged instead of raw URLs; query strings, bodies, authorization, cookies, emails, IPs and user agents are absent.

Express 5 rejected promises, JSON parser errors, body-size errors, CORS failures, domain errors, unknown routes and unexpected faults now converge on one final mapper. Public errors use stable `application/problem+json`; internal errors become `internal_error` without a message or stack. The client reads the new top-level code and temporarily accepts old `{error:{code}}` envelopes until P0D-S6 retires compatibility routes.

The live contract now also documents:

- `GET /health/live`: public process liveness only;
- `GET /health/ready`: public aggregate `ready`/`not_ready`, with `503` while a required bounded probe fails;
- `GET /health/dependencies`: current Bearer authentication plus the existing superadmin audit-read policy, returning only dependency names and `ok`, `unavailable` or `optional_unavailable`.

MongoDB and PostgreSQL probes execute a real ping in the composed server. Identity and file checks reflect enabled runtime modules. No URI, bucket, migration hash, exception, latency trace or source identifier is returned.

## 18. P0D-S3 browser and abuse-control contract

Credentialed CORS accepts only an exact configured web origin; the server never emits a wildcard, reflects an unknown origin or trusts an origin merely because it is syntactically valid. Preflight advertises only the reviewed methods and headers, returns no body, and does not consume an application rate-limit token. Originless non-browser clients remain usable, while unsafe browser requests with untrusted `Origin` or cross-site Fetch Metadata are rejected before parsing or routing. Refresh and logout continue to require the session-bound double-submit CSRF token.

Request classification comes from the executable operation registry plus a small isolated legacy map. Bodyless routes receive an 8 KiB ceiling, v1 JSON 32 KiB, ordinary compatibility JSON 64 KiB and the few retained expensive compatibility routes 256 KiB. JSON is strict, uncompressed and limited to JSON media types; malformed, oversized and encoded bodies use the central problem contract.

Rate classes are `read`, `write`, `authentication`, `administration`, `upload`, `execution` and `external`. Responses publish standard bounded limit/remaining/reset metadata without identifying a user or account. Client keys are per-process HMAC digests rather than stored IP addresses. Forwarding headers affect the key only when the direct peer matches an exact configured IP/CIDR. The injected store contract is stable; the bounded fixed-window memory store is a free/local single-instance fallback, not a distributed production authority.

## 19. P0D-S4 restricted-content contract

Rich content is never transported as trusted HTML. Version 1 documents have exactly `version`, `format` and `text`; supported formats are `plain_text_v1` for notes and `restricted_markdown_v1` for AI/course explanatory content. Unknown versions, formats, extra fields, non-string text and excessive length fail with stable value-free errors.

Compatibility note reads return `contentDocument` plus a plaintext `content` bridge. A row without the new format marker is treated as `legacy_html_v0`, converted to an inert projection for display and left unchanged in storage until an explicit user save or reviewed migration. New saves send the document object and store plaintext. AI responses return both the compatibility `answer` string and `answerDocument`; the renderer supports paragraphs, lists, bold, inline code and fenced code only. It does not support raw HTML, links, images or embeds.

URLs are a separate type rather than Markdown behavior. Navigations/media accept only HTTP(S) without credentials. YouTube embeds require a reviewed host and exact eleven-character video ID and are canonicalized to the privacy-enhanced origin. Unsafe or ambiguous values render no link/media rather than falling through to browser scheme handling.

## 20. P0D-S5 executable operation-security contract

`security-coverage.js` is the exact security companion to the operation registry. Its key set must equal the 41 deployed v1 operation IDs, and each record fixes authentication (`public`, `optional`, or current Bearer), resource scope (`none`, `self`, `organization`, `file`, or `platform`), exposure, and a known permission where policy evaluation is required. Organization, file, and self operations cannot degrade to `none`.

Only five reviewed operations may return an ephemeral capability: registration, login and refresh may return a short-lived access token; file upload-intent and download operations may return a bounded signed URL. The generated component schemas and representative DTO projections are recursively checked for forbidden credential, hash, provider-secret, object-key and quarantine fields. Audit before/after state is an exact `AuditState` object rather than arbitrary repository JSON.

Adding an operation, scope, permission, capability or response field requires updating the registry, closed DTO schema and executable coverage in one change. The gate deliberately does not bless retained unversioned compatibility responses; those remain temporary surfaces owned by P0D-S6 and later feature migrations.

## 21. P0D-S6 operation reliability and compatibility contract

Idempotency is an injectable operation primitive. Scope is actor plus stable operation ID plus validated request key; persistence receives the actor/action and a SHA-256 scope, never the raw key or request. Canonical JSON produces the request digest. Acquisition returns `acquired`, `replay`, `conflict`, or `in_progress`; a UUID lease permits crash recovery, exact completion, and abandonment. Only bounded 2xx–4xx JSON without credential/token fields can be replayed. The in-memory adapter is local/test only; the PostgreSQL adapter is the production authority.

Audit envelopes require an explicit state-field allowlist, discard repository-only fields, forbid credential/hash/storage/quarantine field families, bound strings/arrays/bytes and are immutable. PostgreSQL appends only and replays an exact `operationKey`; the database trigger continues to reject updates/deletes. Outbox workers claim at most 100 events with expiring job leases, deterministic bounded backoff, stable public error codes and at-least-once semantics. Logs contain event ID/type/attempt only, never payload or upstream error text.

Authentication compatibility is closed: `x-auth-token`, its recovery principal/configuration and the `JWT_SECRET` alias no longer exist. The exact unversioned mount lifecycle is executable in `legacy-route-lifecycle.js`; `/api/auth` and `/api/admin` are tombstones, active feature routes name Phase 1–4 replacements, and the existing atomic cutover switch returns `410` for every mount. This dependency-driven sequencing prevents an intentional authentication retirement from breaking still-unmigrated product features.

## 22. P0F-S4 OpenAPI CI contract

`npm run openapi:check` loads the executable v1 registry and compares its canonical pretty-printed document byte-for-byte with `docs/openapi/codewithmee-v1.openapi.json`. It does not update the artifact. Any path, operation, schema, security or ordering change therefore fails the quality job until `npm run openapi:export` is run deliberately and the semantic diff is reviewed.

The checked surface remains OpenAPI 3.1.1 with 37 paths and 41 operations. The CI check complements, rather than replaces, server tests that require every registered operation and schema reference to resolve and every operation to have one exact security record. Generated clients remain a future consumer; the committed artifact is not treated as authoritative when it disagrees with executable contracts.
