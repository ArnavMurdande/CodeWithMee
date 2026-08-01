# CodeWithMee Database Plan

**Status:** Target data model  
**Audit date:** 2026-07-31  
**Authoritative store:** PostgreSQL 16+ through Prisma migrations

## 1. Decision and migration boundary

The current domain and compatibility Mongoose models are useful prototypes, but they are not a safe production schema. P0C-S2 registers 18 present model files/collections so none disappear silently during migration. The target uses PostgreSQL because CodeWithMee's core invariants are relational: a person can belong to multiple providers; published course versions must remain stable for existing enrollments; grades and payment reviews need auditable state; follows and blocks update both access and feed behavior; credits require a ledger; and submissions must reference the exact challenge version that was judged.

MongoDB remains read-only only during Phase 0 migration and the rollback window. New features after Phase 0 write only PostgreSQL. A temporary dual-read is allowed behind a feature flag; uncoordinated dual-write is not.

Conventions:

- Primary keys: UUID (`uuid`), generated server-side. Externally visible IDs are opaque.
- Time: `timestamptz` in UTC with `created_at` and `updated_at` where applicable.
- Deletion: `deleted_at` for recoverable user content; immutable audit/ledger rows are not hard-deleted.
- Money: integer minor units plus ISO currency (`amount_minor`, `currency`), never floating point.
- Ordering: integer/fractional position with a unique parent/position constraint.
- Flexible metadata: `jsonb` only for bounded, versioned metadata—not as a substitute for relationships.
- Text search: PostgreSQL full-text search at first; an external search engine is deferred until measured need.
- Every foreign key has an explicit deletion policy; production code does not rely on orphan cleanup jobs.

### P0C-S1 implementation baseline

The first executable slice is committed in `prisma/schema.prisma` and `prisma/migrations/20260801000100_core_baseline/migration.sql`. It contains 25 Phase 0 tables and 19 enums for authorization definitions, identity/sessions/OAuth, organizations/invitations/reviews, file metadata, authority/audit/idempotency/outbox/jobs/flags and import provenance. PostgreSQL-specific SQL adds the partial indexes, lifecycle checks, immutable audit trigger and deferred exact-owner invariant that Prisma cannot express. Schema and migration checksums/byte counts are fixed in `prisma/migration-manifest.json`.

The migration was fresh-applied to disposable PostgreSQL 16.14, seeded twice with 34 permissions, 14 built-in roles and 95 grants, exercised by transactional constraint tests, and compared back to the Prisma schema with no detected drift. It creates no user or superadmin. This proves the empty target, not source parity or cutover: the remaining learning, challenge, LMS, social, idea and workspace tables land through P0C-S4 and their owning feature migrations without changing the model below.

### P0C-S2 source migration boundary

`scripts/migrate-mongo-to-postgres/` fixes a schema-versioned registry for all 18 current Mongoose collections and a deterministic canonical representation for BSON-compatible records. Source access is independent of application runtime: only `MIGRATION_SOURCE_MONGO_URI`, `MIGRATION_SOURCE_MODE=read_only`, exact `read-only:<database>` approval and server-disclosed allowlisted read roles can open MongoDB. Primary/majority reads avoid mixing lagging replicas during an export. The normal `MONGO_URI` is ignored.

Exports are exclusive directories containing one independently authenticated AES-256-GCM frame per canonical record. Associated data binds schema, collection and record position; the manifest fixes plaintext/ciphertext hashes and counts and is HMAC-authenticated with the export key. This permits bounded streaming while ensuring no record is parsed before its own tag verifies. Inventory and dry-run reports use HMAC fingerprints instead of source IDs, database labels, upload paths or filename owner hints. Index filters expose field shape only, not literal values.

The dry-run maps each source record to stable UUIDv5 target identifiers and normalized target types without opening PostgreSQL. Missing/duplicate identity, unsupported credential hash, company claim, dangling relation/polymorphic author and paid-currency ambiguity is quarantined. Legacy reset tokens are discarded, enrollment progress becomes non-authoritative snapshot evidence, and all legacy challenge tests are explicitly visible pending author review. P0C-S4 must persist reviewed transformations into the existing `import_runs`, `import_records` and `import_exceptions` provenance model; P0C-S2 authorizes no live import.

## 2. Current MongoDB model assessment

| Current model        | Reusable concept                                                              | Production problem                                                                                             | Target                                                                          |
| -------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `User`               | profile, auth method, roadmap, progress, notes, challenge and social concepts | unbounded embedded arrays, mixed concerns, separate score/points, sensitive fields returned too broadly        | split across identity, learning, notes, social, credit, and organization tables |
| `Challenge`          | statement, difficulty, tags, tests, discussion                                | reference solution and hidden tests share learner response object; comments recursive; no versions/submissions | versioned challenge/test/submission tables plus shared comments                 |
| `YouTubeCache`       | query-to-video cache with expiry                                              | external-query cache is authoritative-looking and public endpoint is unthrottled                               | bounded integration cache with provider metadata and expiry                     |
| `Company`            | provider profile and approval state                                           | credential is the organization; one admin email/password; pending status not enforced                          | organizations plus human memberships and verification workflow                  |
| `CompanyEmployee`    | organization membership                                                       | missing uniqueness, invitation lifecycle, provider roles                                                       | organization memberships and invitations                                        |
| `Course`             | course/module/content draft                                                   | embedded mutable content, no published versions, assessments or ownership roles                                | normalized authoring plus immutable published versions                          |
| `Enrollment`         | enrollment and rough completion                                               | duplicated in user, arbitrary content IDs can inflate progress, no payment/invite provenance                   | constrained enrollments, lesson progress, payment/invitation links              |
| `Post`               | posts, attachments, reactions, nested discussion                              | string actor IDs, unbounded recursive comments, no indexes/report states                                       | normalized posts, media, comments, reactions and reports                        |
| `Project`            | idea/project title, visibility, milestones                                    | only public/private, no collaborators/artifacts/suggestions/history                                            | complete Creative Space idea domain                                             |
| deleted `Submission` | durable challenge attempts                                                    | removed and no longer used                                                                                     | redesigned versioned submissions and case results                               |

## 3. Core identity, organization, and operations tables

### Identity

| Table                       | Key columns and constraints                                                                                                                                                                                                                                                                                |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`                     | `id`, unique normalized `email`, `display_name`, `username`, status (`active`, `suspended`, `banned`, `deletion_pending`), platform role (`learner`, `moderator`, `superadmin`, optional `support`), `authority_revision`, `email_verified_at`, `avatar_file_id`, timestamps; username unique when present |
| `auth_identities`           | `user_id`, `provider` (`local`, `google`), `provider_subject`, `password_hash`; unique `(provider, provider_subject)`; local hash nullable only for non-local identity                                                                                                                                     |
| `sessions`                  | `user_id`, client (`web`, `extension`), family/session ID, authentication time, absolute/idle expiry, `revoked_at`, `compromised_at`, `last_used_at`, device/IP metadata; indexes on user and active expiry                                                                                                |
| `session_refresh_tokens`    | session, unique token hash, state (`current`, `consumed`), issued/consumed timestamps; rotation atomically consumes the current token and creates the next, while reuse revokes the parent session family                                                                                                  |
| `email_verification_tokens` | hashed token, user, expiry, consumed timestamp; one active token policy                                                                                                                                                                                                                                    |
| `password_reset_tokens`     | hashed token, user, expiry, consumed timestamp; never returned by a profile endpoint                                                                                                                                                                                                                       |
| `oauth_clients`             | first-party web/extension clients, redirect URI allowlist, allowed scopes                                                                                                                                                                                                                                  |
| `oauth_authorization_codes` | hashed one-time code, PKCE challenge/method, client, user, scopes, expiry, consumed timestamp                                                                                                                                                                                                              |

### Organizations/providers

P0B-S3 now exercises this target shape behind a replaceable repository. Its isolated Mongoose compatibility collections use UUID public identifiers, unique organization slugs and membership pairs, hidden HMAC invitation tokens, sparse active invitation/review keys, optimistic organization revisions and explicit lifecycle enums. They are not the target authority: Phase 0C must migrate them into the tables below and implement multi-record owner/invitation/review transitions as PostgreSQL transactions.

| Table                           | Key columns and constraints                                                                                                                                                                                          |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `organizations`                 | `id`, unique slug, name, description, industry, logo file, `verification_status`, owner user, timestamps                                                                                                             |
| `organization_memberships`      | organization, user, role (`owner`, `admin`, `instructor`, `grader`, `analyst`), status (`active`, `suspended`, `revoked`); unique `(organization_id, user_id)`; last-active-owner invariant enforced transactionally |
| `organization_invitations`      | organization, normalized email, role, hashed token, inviter, expiry, accepted/revoked timestamps; unique active invitation per organization/email/role                                                               |
| `provider_verification_reviews` | organization, reviewer, status, notes, evidence file references, reviewed timestamp                                                                                                                                  |

### Files and operations

| Table                | Key columns and constraints                                                                                                                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `files`              | owner user/org, purpose, storage key, original name, declared/detected MIME, bytes, SHA-256, scan status, visibility, timestamps; storage key and checksum indexed                                 |
| `audit_events`       | actor, organization, action, target type/id, correlation ID, reason, allowlisted before/after state, source/operator reference, timestamp; append-only; unique one-shot operation key when present |
| `authority_controls` | unique control key and revision used to serialize platform-role/status/bootstrap invariants; internal only                                                                                         |
| `idempotency_keys`   | actor, route/action, key, request hash, response reference, expiry; unique `(actor_id, action, key)`                                                                                               |
| `outbox_events`      | aggregate type/id, event type/version, payload, available/processed timestamps, attempt count; index pending order                                                                                 |
| `job_runs`           | job type, source event, state, attempt, lease, error summary, timestamps; unique idempotency/source key                                                                                            |
| `feature_flags`      | key, environment, value, rollout rules, updated by; audited changes                                                                                                                                |

P0B-S6 proves the compatibility transaction contract for these rows. The first Prisma migration must implement `users.authority_revision`, append-only audit access, a unique bootstrap operation marker, serialized authority control, session revocation in the same role/status transaction, and owner/member/organization/audit updates in one ownership transaction. Seeds create role/permission definitions only; they must never silently create or promote a human superadmin.

## 4. Challenges and execution

| Table                     | Key columns and constraints                                                                                                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `challenges`              | stable identity, slug, author/provider, lifecycle (`draft`, `published`, `retired`), current version                                                                                                   |
| `challenge_versions`      | challenge, version number, title, statement, constraints, difficulty, score, time/memory/output limits, reference solution, checker type/config, published timestamp; unique `(challenge_id, version)` |
| `tags`                    | unique normalized name and display name                                                                                                                                                                |
| `challenge_tags`          | version/tag join; unique pair                                                                                                                                                                          |
| `challenge_starter_files` | version, language, path, content, entrypoint, order; safe relative path constraint; unique `(version_id, language, path)`                                                                              |
| `challenge_test_cases`    | version, ordinal, visibility (`visible`, `hidden`), input, expected output, weight, timeout override; unique `(version_id, ordinal)`                                                                   |
| `submissions`             | user, challenge/version, language/runtime version, source snapshot/hash, kind (`run`, `submit`), state, verdict, score, duration/memory, idempotency key, timestamps                                   |
| `submission_case_results` | submission, case, verdict, duration/memory, redacted output, internal diagnostics; unique pair; hidden case details never map to learner DTOs                                                          |
| `execution_jobs`          | submission, signed runner job ID, state/lease/attempt, limits snapshot, runner version, error category, timestamps                                                                                     |
| `challenge_solutions`     | user/challenge, first solved submission/time, best submission/score; unique user/challenge                                                                                                             |
| `challenge_discussions`   | optional link from a general comment thread to a challenge version                                                                                                                                     |

Rules:

- Publishing creates an immutable version. A later edit creates a new version.
- A run may use visible cases or custom stdin; a submit uses the version's full hidden suite.
- Source retention is configurable and disclosed. Private provider assessments may use shorter retention.
- Hidden expected values can be encrypted at application level if threat modeling requires it, but authorization and DTO separation are mandatory regardless.

## 5. Courses, lessons, progress, and assessments

### Authoring and publishing

| Table                  | Key columns and constraints                                                                                                                                                                                     |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `courses`              | provider, slug, lifecycle, visibility, pricing mode, amount/currency, current draft/published version, creator                                                                                                  |
| `course_versions`      | course, version, title, description, thumbnail, category, settings, published by/at; unique version                                                                                                             |
| `course_modules`       | course version, title, description, position; unique parent position                                                                                                                                            |
| `lessons`              | module, type (`video`, `note`, `resource`, `link`, `challenge`, `quiz`, `assignment`), title, body/document, position, required flag, completion policy                                                         |
| `lesson_video_sources` | lesson, provider (`youtube`, `external`, `upload`), canonical URL/video ID, duration, captions/transcript file, position                                                                                        |
| `lesson_resources`     | lesson, file or validated external URL, allow download, display name, position                                                                                                                                  |
| `course_staff`         | course/user, narrowed role (`manager`, `instructor`, `grader`, `analyst`, `payment_reviewer`), status, explicit instructor-publish flag; active parent-organization membership must also authorize; unique pair |

### Enrollment and progress

| Table                       | Key columns and constraints                                                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `course_invitations`        | course/version, organization, email/user, token hash, seats, expiry, inviter, accepted/revoked state                                                               |
| `enrollments`               | user, course, course version, source (`catalog`, `invite`, `provider`, `payment`), status, payment order, enrolled/completed timestamps; unique active user/course |
| `lesson_progress`           | enrollment/lesson, state, progress ratio, completed timestamp, revision, last activity; unique pair                                                                |
| `video_progress`            | enrollment/lesson/source, position seconds, duration seconds, watched intervals/ratio, revision, updated timestamp; unique enrollment/source                       |
| `module_progress_snapshots` | enrollment/module, derived percentage and computed timestamp; cache, not client-writeable authority                                                                |
| `course_progress_snapshots` | enrollment, derived percentage and computed timestamp; cache, reconciled from lesson progress                                                                      |

### Quizzes and assignments

| Table                         | Key columns and constraints                                                                                                              |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `quizzes`                     | lesson, attempts limit, passing score, shuffle/timing settings                                                                           |
| `quiz_questions`              | quiz, type (`single`, `multiple`, `short`, `written`), prompt, points, rubric, position                                                  |
| `quiz_options`                | question, text, correctness (never learner DTO), position                                                                                |
| `quiz_attempts`               | quiz, enrollment/user, attempt number, state, started/submitted/graded timestamps, score; unique attempt number                          |
| `quiz_answers`                | attempt/question, selected options or text, auto/manual score, grader feedback; unique pair                                              |
| `assignments`                 | lesson, instructions, due policy, accepted types, max files/bytes, rubric, passing requirement                                           |
| `assignment_submissions`      | assignment/enrollment/user, revision, state, text answer, submitted timestamp; unique revision                                           |
| `assignment_submission_files` | submission/file join, position; unique pair                                                                                              |
| `grades`                      | subject type/id, grader, score, max score, status, rubric result, feedback, graded timestamp; unique current grade with revision history |
| `grade_events`                | grade, actor, from/to status/score, reason, timestamp; append-only history                                                               |

### Manual QR payment

| Table             | Key columns and constraints                                                                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `payment_orders`  | user, course/version, amount/currency snapshot, status (`pending_proof`, `under_review`, `approved`, `rejected`, `expired`, `refunded`), expires timestamp |
| `payment_proofs`  | order/file, payer reference, note, submitted timestamp; immutable submission revisions                                                                     |
| `payment_reviews` | order, reviewer, decision, reason, timestamp; one terminal approval enforced transactionally                                                               |

Payment approval creates the enrollment and audit/outbox events in one transaction. Manual proof is not described as automated payment confirmation.

## 6. Social Space, moderation, credits, and notifications

| Table                      | Key columns and constraints                                                                                      |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `profiles`                 | user, bio, headline, links/document, visibility settings; one per user                                           |
| `follows`                  | follower/followed, state (`pending`, `accepted`), timestamps; unique pair, no self-edge check                    |
| `blocks`                   | blocker/blocked, reason/timestamp; unique pair, no self-edge check                                               |
| `posts`                    | author user, body, visibility, moderation state, timestamps, soft deletion                                       |
| `post_media`               | post/file, alt text, position; unique parent position                                                            |
| `comments`                 | author, parent target type/id, optional parent comment, depth, body, moderation state, timestamps; bounded depth |
| `reactions`                | actor, target type/id, type; unique actor/target/type or unique actor/target depending product rule              |
| `saved_items`              | user, target type/id, timestamp; unique pair                                                                     |
| `activity_events`          | user, type, source type/id, occurred date/time, points policy version; unique source event where appropriate     |
| `streaks`                  | user, streak type, current/best, last qualifying date; derived/reconcilable                                      |
| `reports`                  | reporter, target, category, details, status, timestamps; rate-limited and private                                |
| `moderation_cases`         | report group/target, assignee, priority, state, resolution, timestamps                                           |
| `moderation_actions`       | case, actor, action, duration/reason, target, timestamp; append-only                                             |
| `appeals`                  | action, requester, text, state, reviewer, decision timestamps                                                    |
| `credit_accounts`          | user, cached balance, version; one per user                                                                      |
| `credit_transactions`      | account, signed delta, reason, source type/id, policy version, timestamp; immutable; unique source reference     |
| `award_definitions`        | key, label, cost/reward rules, active/version                                                                    |
| `awards`                   | giver, recipient, target, definition, credit transaction, timestamp; unique according to product rule            |
| `notifications`            | user, type, actor, target, payload version, read timestamp, created timestamp                                    |
| `notification_preferences` | user, event type/channel, enabled, digest settings; unique pair                                                  |

Blocking is symmetric for visibility even though the actor relationship is directional: either direction excludes profile discovery, feed, comments, follow actions, comparisons, and notifications between the pair.

## 7. Creative Space

| Table                | Key columns and constraints                                                                                            |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `ideas`              | owner, title, summary, body document, visibility (`private`, `connections`, `public`), state, timestamps               |
| `idea_collaborators` | idea/user, role (`owner`, `editor`, `commenter`, `viewer`), invited/accepted state; unique pair                        |
| `idea_notes`         | idea, author, title/body document, visibility to collaborators, timestamps                                             |
| `idea_links`         | idea, kind (`reference`, `repository`, `demo`), validated URL, label, position                                         |
| `idea_files`         | idea/file, label, position                                                                                             |
| `idea_comments`      | use shared `comments` target or dedicated view; author, parent, body, state                                            |
| `suggestions`        | idea, author, category, problem, proposal, status (`open`, `accepted`, `rejected`, `implemented`), decision actor/time |
| `suggestion_votes`   | suggestion/user, vote `-1` or `1`; unique pair                                                                         |
| `idea_updates`       | idea, author, title/body, source revision, timestamp; append-only timeline                                             |
| `prototypes`         | idea, submitter, kind, repository/demo URLs, file, notes, status, timestamps                                           |
| `blueprints`         | idea, version, structured schema, rendered document, model/prompt version, status, creator, timestamps                 |
| `blueprint_jobs`     | idea/requester, input hash, quota/cost fields, state, provider job, error category, timestamps                         |

Visibility is enforced for every child query through the parent idea policy. Possessing a child ID never bypasses idea access.

## 8. Browser IDE and extension

| Table                     | Key columns and constraints                                                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `workspace_templates`     | source type/id, version, language/runtime, validation spec, starter manifest                                                       |
| `workspaces`              | owner, template, title, state, current revision, timestamps, quota bytes                                                           |
| `workspace_files`         | workspace, normalized relative path, text content or file reference, language, revision, deleted flag; unique active path          |
| `workspace_snapshots`     | workspace, revision, manifest/hash, reason (`autosave`, `manual`, `reset`, `submit`), creator, timestamp                           |
| `workspace_runs`          | workspace/snapshot, execution job, command/task, result summary, timestamp                                                         |
| `validation_specs`        | template/task, version, public instructions, private checks, limits                                                                |
| `validation_results`      | workspace/snapshot/spec, state, score, learner-safe feedback, timestamp                                                            |
| `extension_installations` | user, installation ID, display name, last seen, revoked timestamp; no raw secret                                                   |
| `generator_jobs`          | user/idea/blueprint, requested template, state, output workspace/template, timestamps                                              |
| `repository_exports`      | user/workspace, destination metadata, manifest hash, confirmation/audit state; never store long-lived Git credentials in plaintext |

Small text workspace files can live in PostgreSQL initially. Binary files and large snapshots live in object storage. Quotas and manifest hashes prevent unbounded storage and ambiguous synchronization.

## 9. Index and query plan

Mandatory index families:

- normalized unique email, username, organization slug, course slug, challenge slug;
- active sessions by user/expiry;
- organization memberships by user and organization/role/status;
- published courses by visibility/provider/category/published time;
- enrollments by user/status and course/status;
- progress unique keys plus enrollment/activity time;
- submissions by user/challenge/time and challenge/verdict/time;
- posts by moderation state/visibility/created time and author/created time;
- follows in both directions by state; blocks in both directions;
- comments by target/created time and parent comment;
- reports/cases by state/priority/created time;
- ideas by visibility/owner/updated time and collaborator/user;
- notifications by user/read state/created time;
- jobs/outbox by pending state/availability;
- files by owner/purpose/scan state and storage key.

Feed, leaderboard, analytics, and moderation queries require `EXPLAIN ANALYZE` fixtures before release. In-memory sorting/filtering of entire collections is not an acceptable production query plan.

## 10. Constraints and invariants

- A banned/suspended user cannot create content, submit code, or authenticate a new session; read access follows moderation policy.
- An organization must be approved before publishing or selling a course. Draft creation may be allowed while pending.
- Only authorized organization members can edit a course; only owners/admins manage staff and payment settings.
- Course versions and challenge versions are immutable after publishing.
- A lesson progress row must belong to the same course version as its enrollment.
- A submitted quiz answer must belong to the attempt's quiz version.
- Payment amounts and course version are snapshots and cannot be changed after proof submission.
- Accepted payment creates at most one enrollment.
- Hidden test material is readable only by challenge managers and execution services.
- Credit balance changes only through ledger transactions; deletion of a liked post cannot silently erase unrelated credits.
- A block prevents new follows and invalidates/purges the relevant accepted/pending edge transactionally.
- `private` and `connections` idea access applies to all notes, files, comments, suggestions, blueprints, and prototypes.
- Workspace paths are normalized relative POSIX paths with no `..`, absolute path, drive prefix, NUL, symlink, or reserved-device escape.

## 11. Migration plan from the current repository

1. Inventory Mongo collections, counts, indexes, duplicate emails/company IDs, dangling references, array sizes, and file URLs.
2. Export a timestamped BSON/JSON snapshot and an upload manifest containing path, size, MIME detection, owner inference, and SHA-256.
3. Create Phase 0 Prisma migrations and seed platform roles/permissions.
4. Migrate `User` and `Company` credentials into users, identities, organizations, and memberships. Company admin accounts require explicit mapping/claim flow if no matching user exists.
5. Migrate challenges into draft/published versions. Mark all existing tests as visible until authors explicitly classify them; never assume legacy hidden flags were secret because the API exposed them.
6. Migrate roadmaps, video progress, notes, and conversations into bounded tables.
7. Migrate course/provider data, preserving current completion as an imported snapshot plus lesson-level rows only where the source is provable.
8. Migrate posts/comments/projects into normalized social/idea tables. Reconcile string/ObjectId actor values and reject or quarantine dangling actors.
9. Upload files by hash to private object storage, scan them, and create file rows. Duplicates may share bytes but retain separate ownership records.
10. Run parity reports: entity counts, owners, relationships, progress totals, balances, orphan count, and file checksum count.
11. Perform a rehearsal against a disposable environment, record duration, then execute a short write freeze/cutover.
12. Keep the original database and uploads read-only through the rollback window; destroy them only under an approved retention plan.

## 12. Backup, retention, and privacy

- Development/free tiers are not trusted backups. Export encrypted logical backups to a separate account/location on a schedule.
- Paid production uses provider point-in-time recovery plus daily logical backups and quarterly restore drills.
- Define retention separately for execution source, AI conversations, rejected uploads, payment evidence, audit logs, deleted social content, and account deletion.
- Account export gathers user-owned learning, social, idea, and workspace data without exposing hidden tests, other users' private data, moderation internals, or provider rubrics.
- Account deletion pseudonymizes records that must remain for financial/audit integrity and deletes or reassigns content according to policy.

## 13. Database acceptance criteria

- Prisma migrations can create a clean database from zero and upgrade the previous release.
- Every listed invariant has a database constraint, transaction-level policy, or automated invariant test.
- Migration is repeatable and produces the same counts/checksums from the same snapshot.
- No production route reads/writes Mongoose after the Phase 0 cutover.
- No unbounded user or post document equivalent exists.
- Hidden challenge data, password/reset/session secrets, payment evidence, and private files are absent from general profile/content queries.
- Backup restore, point-in-time recovery (paid environment), and rollback procedures are demonstrated and recorded.

## 14. P0C-S3 implemented file persistence boundary

The existing `file_objects` table is now exercised by the runtime file service through a narrowly scoped PostgreSQL repository. Its transitions and matching `outbox_events` are transactional: a pending row cannot become downloadable until object size, declared MIME, file identifier and SHA-256 metadata match and a trusted scan result is `clean`. A ready/public row therefore satisfies both service and database invariants. Delete marks metadata first and requests object deletion without exposing the storage key.

No schema migration was necessary. Prisma remains authoritative for schema generation/migrations, while the current CommonJS server uses parameterized `pg` transactions behind the same repository interface; the generated Prisma 7 `prisma-client` TypeScript ESM output is not imported directly. P0C-S4 may replace that adapter only after a compatible module/build boundary is verified and its transaction/DTO tests remain unchanged.

P0C-S3 created only synthetic disposable rows. Legacy upload names do not establish owners, so P0C-S4/P0C-S5 must map an explicitly reviewed principal, compare source and destination SHA-256, scan the copied object, retain source bytes through rollback, write import provenance and quarantine every ambiguous file. Duplicate bytes may be deduplicated physically later, but each logical owner/purpose keeps a separate authorization record.

## 15. P0C-S4 normalized legacy implementation

`20260801000200_normalized_legacy_domains` and `20260801000300_normalized_legacy_interactions` add 37 tables and seven enums without changing the immutable Phase 0 baseline. They normalize current embedded/source behavior into learning profiles, roadmaps/topics, conversations, notes/attachments, video/job progress, social profiles/relationships/blocks, versioned challenges/cases/comments/interactions, course versions/modules/content/enrollments, post/comment media/interactions, ideas/milestones/updates/interactions and a hashed integration cache. PostgreSQL checks enforce bounded state, JSON shape, non-self relationships, exactly one polymorphic author, reviewed paid currency and non-authoritative import progress.

The write importer reopens only a P0C-S2 authenticated snapshot. Target and child UUIDs are deterministic; each source record writes in its own transaction and receives one `import_records` row containing an HMAC source fingerprint and source checksum. Planner/import exceptions use safe codes and field names, never source values. A rerun of the same dataset/configuration resolves to the prior reconciled `import_runs` row. Expected semantic quarantine does not abort unrelated records; an infrastructure failure marks the run failed.

## 16. P0C-S5 runtime persistence and reconciliation implementation

Migration `20260801000400_persistence_cutover_runtime` adds `actor_session_id`, `request_id` and `occurred_at` to `audit_events`, preserving the complete authority-service audit contract without weakening the append-only trigger. It adds no domain table and activates no flag. The manifest pins all four migration files plus the 62-model Prisma schema by bytes and SHA-256.

The core PostgreSQL repositories use explicit parameterized SQL and transactions over the Prisma-owned schema:

- identity writes user plus identity atomically, stores only hashed refresh/CSRF/IP/user-agent material, rotates one-current-token families and revokes a family on consumed-token reuse;
- organization create/accept/review/decision operations are transactional and rely on the deferred exactly-one-active-owner constraint;
- authority serializes against the control row at `SERIALIZABLE`, uses optimistic revisions, protects the last superadmin, revokes sessions in the authority transaction and appends immutable audit rows.

The import summary now persists safe per-collection counts. `migration:parity` opens one repeatable-read, read-only transaction against the exact approved database/dataset and writes a new exclusive HMAC-authenticated JSON artifact. Root imported targets are joined back to provenance, while domain checks cover identity presence/provider secret shape, exact owners, versions, author XOR rules and hashed cache keys. Quarantines and error exceptions block readiness; intentional security-state skips remain visible warnings.

Database feature flags are the second activation key. The guarded command writes `persistence.<domain>.store` JSON with store/state/environment/generation/dataset/report/snapshot/deadline and appends one audit event per domain. Runtime startup refuses a PostgreSQL store unless every value matches its deployment configuration. The fixture report correctly blocks the core group; only a synthetic ready control was activated and rolled back locally. No live source or target was changed.

Security-state rules are fixed: active sessions, one-time tokens and pending invitations are not migrated; legacy company passwords are discarded; local password hashes migrate only when bcrypt/Argon2id-shaped; Google accounts require a real provider subject or relink; reset flows are reissued. Legacy paid courses without trusted ISO currency, duplicate/invalid users, unclaimed companies, dangling parents and inconsistent authority are quarantined. Progress snapshots remain non-authoritative and all challenge cases remain visible. The P0C-S5 machinery cannot replace live evidence: counts, relationships, file hashes and every selected domain must pass a new authenticated report before runtime flags change.

## 17. P0C-S6 backup, restore, and orphan implementation

The portable backup excludes `_prisma_migrations` data but requires the exact manifest migration set and schema SHA-256. The verified P0C-S6 drill used the then-current four migrations; after P0D-S4/P0D-S6 the current manifest contains six and the next target rehearsal must apply all six. It exports all 62 application tables in a repeatable-read/read-only transaction, preserving every column value as PostgreSQL text inside a gzip/AES-256-GCM envelope. Restore requires a different migrated database, permits replacement of only the two exact migration-created `authority_controls` rows, aborts on any other preexisting data, inserts in dependency order and re-exports every table before commit. The verified disposable rehearsal restored 280 rows and produced the same content SHA-256; a second restore was rejected.

This is a small-data verifier with a 256 MiB plaintext bound. Paid production still requires managed PITR, scheduled encrypted native custom-format exports to failure-isolated storage, retention monitoring and restore drills. Object bytes are protected through bucket versions/replication and inventory, not the database archive. The read-only reconciliation report compares file rows, objects and legacy fingerprints; no automatic deletion is implemented.

## 18. P0D-S4 content-format migration

`20260801000500_restricted_content_formats` adds two checked, non-null format markers without rewriting content bytes. Existing `learning_conversations` are classified as `restricted_markdown_v1` because their source contract was Markdown-like AI text and the new renderer treats every HTML-looking token as text. Existing `learning_notes` are classified `legacy_html_v0`; after the column is populated, its creation default changes to `plain_text_v1`. The check permits only those two note states.

The application projects legacy note HTML to plaintext but does not persist that projection automatically. A future live migration must inventory counts/maximum lengths, preserve an encrypted source backup, convert deterministically, compare sampled text, quarantine over-limit/ambiguous documents and switch each row to `plain_text_v1` in the same transaction. The fifth migration is checksum-pinned and Prisma-valid but was not applied to the retained disposable service because Docker-control approval was exhausted; no live-data claim is made.

## 19. P0D-S6 audited operation persistence

`20260801000600_operation_reliability` adds `lease_id` and `lease_expires_at` to the existing `idempotency_keys` table. Both values are null or present together; a completed response cannot retain a lease. The runtime persists the SHA-256 actor/operation/key scope in the bounded `key` column, keeps the request digest separate, and uses `INSERT ... ON CONFLICT`, row locks and exact lease-bound updates. Expired rows may be replaced; abandoned work deletes only its exact pending lease; completed responses remain replayable until bounded expiry.

Audit writes insert a field-allowlisted envelope into the existing immutable `audit_events` table. `operation_key` makes an exact duplicate append idempotent but conflicts if the action/target/projected state differs. Outbox claims lock pending rows with `SKIP LOCKED`, increment one attempt, create a `RUNNING` `job_runs` lease and recover an expired run as a stable failed attempt. Completion/retry/dead-letter transitions lock both event and current attempt and never interpolate payloads into SQL or logs.

PostgreSQL is the only durable operations authority. Development/test may use bounded memory repositories for deterministic local work, but production without a PostgreSQL pool exposes the operation runtime as unavailable. The migration is validated and checksum-pinned, not applied; apply all six migrations and exercise concurrent claims/recovery against disposable/staging PostgreSQL before enabling dependent routes or workers.

## 20. P0F-S2 isolated integration lifecycle

The earlier “not applied” statements in sections 17–19 are preserved as chronological evidence of those subphases. P0F-S2 subsequently applied all six migrations to fresh PostgreSQL 16.14 databases and exercised the restricted-content and lease-pair/completion checks by their database constraint names. This does not change the runtime authority or constitute staging/production application.

Each test invocation now owns a random source database ending `_ci` and independent restore database ending `_restore_ci`. The administrative URL is accepted only for an explicit loopback user targeting the `postgres` maintenance database under disposable scope. The test prefix and every SQL identifier are allowlisted; staging/production-like prefixes reject. Source creation occurs once, and the outer `finally` force-drops both exact targets and queries `pg_database` for zero remaining names.

CI supplies the maintenance URL and prefix, not a fixed application `DATABASE_URL`. The lifecycle applies the immutable migration chain, seeds twice, executes constraint/import/repository/parity/activation/rollback/file coverage, authenticates an independent portable restore and rejects restoring twice. Application roles must not inherit these CI-only database creation privileges.
