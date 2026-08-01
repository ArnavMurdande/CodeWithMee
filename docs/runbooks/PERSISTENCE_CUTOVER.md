# Persistence cutover and rollback runbook

**Owner:** platform/database operations  
**Implemented by:** `P0C-S5`  
**Default state:** every runtime domain uses `mongoose`; legacy APIs remain enabled  
**Live execution in this repository:** not performed

This runbook is the only supported path for moving runtime authority from MongoDB to PostgreSQL. Import success is not cutover approval. Never enable ad hoc dual writes, edit feature-flag rows by hand, infer identities from filenames, or delete the retained source during the rollback window.

## 1. Current cutover units

| Domain | PostgreSQL adapter | Runtime cutover eligibility | Reason |
|---|---:|---:|---|
| `identity` | Complete | Eligible only with the next two domains | User/session IDs are shared with organization and authority policies. |
| `organizations` | Complete | Eligible only with the other core domains | Owner/membership constraints and file authorization share user IDs. |
| `authority` | Complete | Eligible only with the other core domains | Current user, session revocation, membership and append-only audit writes must be atomic. |
| `learning` | Imported target only | Ineligible | Current HTTP handlers access embedded Mongoose records directly. |
| `challenges` | Imported target only | Ineligible | Current route owns direct model reads/writes and embedded interactions. |
| `courses` | Imported target only | Ineligible | Current course/enrollment route has no replaceable service repository. |
| `social` | Imported target only | Ineligible | Current Space route mixes user/post/project mutations. |
| `ideas` | Imported target only | Ineligible | Current project endpoints do not yet use the normalized idea service. |
| `integrations` | Imported target only | Ineligible | Current YouTube cache route writes Mongoose directly. |

The core cutover is intentionally moved ahead of feature-domain cutovers, but only while `PERSISTENCE_LEGACY_API_MODE=disabled`. This avoids sending PostgreSQL UUID principals into Mongo ObjectId routes. Phase 0D and the owning feature phases replace those routes before their domain flags become eligible.

## 2. Required custody and access

- A dedicated read-only Mongo migration account and an authenticated encrypted source snapshot.
- A least-privilege PostgreSQL migrator for import, a separate read-only parity account, and the normal runtime account.
- `MIGRATION_EXPORT_KEY`, `MIGRATION_FINGERPRINT_KEY`, and `PERSISTENCE_PARITY_KEY` held separately in a secret manager.
- A private source/upload backup whose SHA-256 is recorded as `PERSISTENCE_ROLLBACK_SNAPSHOT_SHA256`.
- An approved change record in `PERSISTENCE_CUTOVER_OPERATOR` and an explicit rollback deadline.
- A maintenance window that can disable all writes. A banner and operational communication are external dependencies; the repository does not pretend they occurred.

## 3. Rehearsal sequence

1. Inventory Mongo and legacy uploads read-only. Resolve or quarantine every exception; do not alter source.
2. Export a new authenticated snapshot and record its dataset SHA-256.
3. Apply all checksum-pinned Prisma migrations to an empty staging target and seed authorization definitions twice.
4. Run the guarded snapshot import. Confirm it ends `reconciled`, then replay it to prove idempotence.
5. Generate a read-only, HMAC-authenticated parity artifact:

   ```powershell
   npm.cmd run migration:parity -- --dataset-sha256 <sha256> --output <new-private-report.json>
   ```

   Set `PERSISTENCE_PARITY_MODE=read_only` and exact approval `parity:<database>:<dataset-sha256>`. The output file must not already exist. Review aggregate outcomes, target existence, structural checks and every warning; it intentionally contains no source IDs, paths, email addresses, secrets or exception values.

6. Confirm all selected domains say `readyForCutover: true`. Core identity/organization/authority readiness must pass together. The command refuses an incomplete core set.
7. Rehearse activation and rollback on staging, including token invalidation, login, session rotation/reuse, organization owner transfer, audit listing, unavailable legacy endpoints and restored Mongo behavior.
8. Restore staging from the retained backup and repeat parity. Record timings, responsible operator, report checksum and acceptable outage budget.

## 4. Production freeze and activation

1. Stop background writers and place all mutation endpoints into maintenance mode. Wait for in-flight requests and outbox work to finish.
2. Record source counts/checkpoints and take the final authenticated Mongo/upload rollback snapshot. Keep it immutable through `PERSISTENCE_ROLLBACK_UNTIL`.
3. Import the final snapshot into the already migrated PostgreSQL target, then generate and approve a new parity report. A prior rehearsal report is invalid.
4. Set the temporary activation environment values documented in `server/.env.example`, including:
   - all three core stores to `postgres`;
   - `PERSISTENCE_LEGACY_API_MODE=disabled`;
   - the dataset, report, snapshot, generation and future rollback deadline;
   - both freeze and rollback-rehearsed confirmations;
   - exact approval `cutover:<environment>:<database>:<generation>:<report-sha256>:authority,identity,organizations`.
5. While writes remain frozen, create the database-side activation records:

   ```powershell
   npm.cmd run persistence:cutover -- activate --apply --domains authority,identity,organizations --report <private-report.json>
   ```

6. Deploy the matching runtime configuration. Startup queries the database-side records and refuses to listen if store, generation, report, dataset, snapshot or rollback deadline differs.
7. Smoke-test `/api/v1` registration/login/refresh/logout, current-role reload, organization membership/invitation/review, authority audit/ownership and private files. Confirm legacy `/api/*` feature routes return `410 legacy_api_disabled_for_cutover` rather than touching Mongo.
8. Watch mismatch/unavailable shadow-read metrics, PostgreSQL errors, auth failures, latency, connection saturation and audit events. Shadow results can never change an HTTP response and logs contain only domain/method/outcome metadata.
9. Resume writes only after the change owner signs the smoke evidence. Keep Mongo and legacy uploads read-only; never dual-write.

## 5. Rollback

Rollback is the safe fallback for any integrity, authorization, session, latency or availability regression during the retained-source window.

1. Re-enter maintenance mode and stop all PostgreSQL writers/background jobs.
2. Record the last PostgreSQL audit/outbox checkpoint. Determine whether any post-cutover writes must be exported for manual reconciliation; never copy them blindly into Mongo.
3. With the same generation and snapshot checksum, set `PERSISTENCE_CUTOVER_MODE=rollback` and exact approval `rollback:<environment>:<database>:<generation>:authority,identity,organizations`.
4. Change the database-side authority records:

   ```powershell
   npm.cmd run persistence:cutover -- rollback --apply --domains authority,identity,organizations
   ```

5. Redeploy all three runtime stores as `mongoose` and re-enable the legacy API only after its source is confirmed current. A stale PostgreSQL deployment fails closed because its environment no longer matches the database record.
6. Revoke sessions issued during the PostgreSQL window, require fresh login, restore paused Mongo jobs and run source-side smoke tests.
7. Keep the failed PostgreSQL state and audit evidence read-only for incident analysis. Do not rerun activation under the same generation; create a new snapshot/report/generation after remediation.

If the source retention deadline has passed or writes cannot be reconciled safely, rollback is no longer automatic. Keep maintenance mode active and escalate to a reviewed forward-fix/data-recovery plan.

## 6. Shadow-read mode

`PERSISTENCE_SHADOW_DOMAINS` accepts eligible domains only and requires exact approval `shadow:<environment>:<database>:<dataset-sha256>:<sorted-domains>`. It compares only natural-key reads that are meaningful across Mongo ObjectIds and PostgreSQL UUIDs. IDs, timestamps and credentials are removed before hashing; arguments and values are never logged. Secondary failure records `shadow_unavailable` and never changes the primary response.

## 7. Completion evidence

A real domain cutover is complete only when the final source snapshot and parity report are authenticated, all selected domains are ready, database and deployment flags match, staging rollback was rehearsed, production smoke/monitoring pass, the write freeze is lifted intentionally, and the retained source remains available through the documented deadline. P0C-S5 supplies and locally verifies the machinery; it does not claim any live environment met these conditions.
