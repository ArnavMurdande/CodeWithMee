# Backup, restore, reconciliation, and legacy-retirement runbook

## Scope and non-goals

This runbook owns `P0C-S6`. It proves that an authenticated PostgreSQL application-data export can be restored into a separately migrated empty database, reconciles private object metadata without deleting anything, and defines the gates for eventually removing Mongo/Mongoose and local upload serving. It does not authorize a production restore, delete a source database, delete an object, or remove a local upload.

The repository archive is a bounded cross-provider recovery verifier. It does not replace production point-in-time recovery (PITR), a provider snapshot, or native PostgreSQL custom-format backups. The archive loads at most 256 MiB of plaintext in memory and is suitable for local/free-tier data sizes and smoke recovery. Move to streaming `pg_dump --format=custom` plus managed PITR before the bound becomes material.

## Recovery layers

1. Managed PostgreSQL PITR is the primary production disaster-recovery layer. Retain at least seven days initially; production policy should grow to 14–35 days when paid infrastructure is approved.
2. A scheduled native `pg_dump --format=custom --no-owner --no-acl` is the portable production database export. Encrypt it with a separately managed key and store it in a bucket/account distinct from the runtime database.
3. `npm run db:backup -- <new-file.cwmbackup>` is the repository-owned logical verifier. It reads all 62 application tables in a repeatable-read, read-only transaction, represents values losslessly as PostgreSQL text, compresses them, and encrypts/authenticates the archive with AES-256-GCM. It excludes `_prisma_migrations` rows but binds the archive to the exact ordered migration list and schema SHA-256.
4. S3-compatible bucket versioning/replication is the object-byte recovery layer. The database backup contains object metadata, not object bytes. Maintain an independently retained inventory of bucket version IDs/checksums and test restoration of representative private files.
5. The authenticated Mongo snapshot and read-only local-upload tree remain the cutover rollback layer until the recorded rollback deadline, parity, independent restore, object reconciliation, and legal-hold gates all pass.

## Portable backup export

Use a dedicated read-only PostgreSQL role. Generate a fresh 32-byte key, encode it as canonical base64, and keep it in the secret manager; never put it in shell history, source control, logs, or the archive directory.

Required settings:

- `DATABASE_URL` naming the exact source;
- `DATABASE_BACKUP_SCOPE=disposable|staging|production`;
- `DATABASE_BACKUP_MODE=read_only`;
- `DATABASE_BACKUP_APPROVAL=backup:<database>:<schema-sha256>`;
- `DATABASE_BACKUP_KEY=<canonical-base64-32-bytes>`.

Run `npm run db:backup -- <new-file.cwmbackup>`. The path must have a real, non-symlink parent and must not exist. The command uses exclusive creation and reports only database/scope, table and row counts, archive SHA-256, and content SHA-256. It never prints a row, credential, object key, email, ID, or encryption key.

Copy the archive to immutable private backup storage, record its SHA-256 in the change record, then remove the working copy. A backup is not accepted until a restore succeeds with the same archive and key.

## Independent restore smoke test

Provision a different, empty database with the same PostgreSQL major. Apply the four committed migrations but do not seed or start the application. The migrations create only the two known `authority_controls` singleton rows; the rest of the application tables must be empty.

Required settings:

- `DATABASE_URL` naming the distinct empty restore target;
- `DATABASE_SAFETY_SCOPE=disposable|staging|production`;
- `DATABASE_RESTORE_MODE=apply`;
- `DATABASE_RESTORE_APPROVAL=restore:<target-database>:<archive-sha256>`;
- the same `DATABASE_BACKUP_KEY` used for the archive.

Run `npm run db:restore -- <file.cwmbackup> --apply`. Restore fails before mutation for a bad format/key/tag/checksum, wrong approval, same source/target name, migration/schema difference, unknown preexisting row, unsafe nullable cycle, or non-empty target. It runs in one serializable transaction, temporarily clears only the two exact migration-created authority-control keys, inserts rows in foreign-key order, restores reviewed nullable cycle pointers, then re-exports all tables and compares the content SHA-256 before commit. Any error rolls the transaction back.

After restore:

1. preserve the signed command evidence and compare archive/content digests;
2. run schema drift, row-count, application read-only smoke, session-revocation and representative private-file restore checks;
3. prove a second restore into the populated target is rejected;
4. destroy only the exact disposable restore target after evidence capture.

CI runs `test:backup:integration` after migration/seed/database integration. It creates an exact `_restore_ci` database on loopback, authenticates an in-memory archive, restores every row, verifies the digest, proves a second restore fails, and drops the exact target.

## File and object reconciliation

Configure the private S3-compatible store plus:

- `FILE_RECONCILIATION_SCOPE=disposable|staging|production`;
- `FILE_RECONCILIATION_MODE=read_only`;
- `FILE_RECONCILIATION_APPROVAL=reconcile:<database>:<bucket>:<prefix>`;
- `FILE_RECONCILIATION_KEY=<independent-canonical-base64-32-bytes>`;
- `LEGACY_UPLOAD_ROOT=<read-only-root>` when the retained tree exists;
- optional `LEGACY_FILE_MAPPING_PATH=<private-json>` containing only `{pathFingerprint,fileId}` mappings.

Run `npm run files:reconcile -- <new-report.reconciliation.json>`. The command opens a repeatable-read, read-only database transaction, lists only the configured bucket prefix, HEAD-checks matched objects, inventories legacy uploads without following symlinks, and creates an HMAC-authenticated report. It never deletes or quarantines anything and reports only keyed references—not raw IDs, paths, object keys, bucket names, or file names.

Blocking issue codes cover database rows with missing objects, provider/bucket/prefix mismatch, incomplete upload objects, object metadata/size/checksum mismatch, objects without database rows, deleted rows whose objects remain, unmapped legacy files, checksum disagreement, source inventory exceptions, and unavailable legacy inventory. Resolve through a separately reviewed repair or quarantine workflow, then rerun from zero. Never infer an owner from a filename.

## Object-byte backup requirements

Before production activation:

1. enable bucket versioning and a retention/lifecycle policy that cannot expire the only recovery copy;
2. export a provider inventory containing key, version, size, checksum, storage class, and deletion marker to a private backup prefix/account;
3. copy or replicate protected versions to a failure-isolated region/account when paid infrastructure is available;
4. restore samples for every file purpose and verify checksum, authorization, scan status, and signed-download behavior;
5. alarm on inventory age, replication failures, missing checksums, lifecycle deletions, and unexpected public ACL/policy changes.

Free-tier object storage can support development inventories and small backups, but egress, version retention, list/HEAD operations, and replication eventually require paid capacity.

## Mongo/Mongoose and local-upload retirement gate

`evaluateLegacyRemovalReadiness` is deliberately non-destructive and `removalIsAutomatic` is always false. It blocks retirement until all of these are true:

- every persistence domain—not only the core—is PostgreSQL authoritative;
- the legacy API is disabled and `/uploads` returns `410 legacy_local_upload_retired`;
- every domain has an authenticated ready parity result;
- a backup authenticates and restores to a different database with identical content SHA-256;
- database/object/legacy-file reconciliation is clean;
- the rollback deadline has expired;
- product/legal owners explicitly clear retention and legal holds.

Even a ready plan requires a new destructive change record naming the exact Mongo database, object prefix, and resolved local-upload root. The future removal change must:

1. freeze writes and take one final immutable source/object backup;
2. prove production reads/writes and background jobs use no Mongoose or local path;
3. remove Mongo configuration/dependencies/models/routes in a normal reviewed release;
4. keep the Mongo database and local tree access-restricted/read-only for the approved final retention period;
5. remove retained data only through provider-native, exact-target operations with audit evidence;
6. monitor errors, parity, file downloads, authentication, jobs and support signals through the agreed observation window.

If any gate regresses, retain the legacy source read-only, leave runtime authority on its already verified store, quarantine ambiguous rows/files, and open a reconciliation incident. Do not dual-write and do not delete to make a report green.

## Free tier and paid upgrade

Local PostgreSQL, the portable verifier, filesystem-held development archives, memory object-store tests, and scheduled low-volume reconciliation can run free. Production requires paid/contracted infrastructure when any of the following applies: meaningful user data, RPO below 24 hours, PITR, cross-account/region copies, protected object versions, more than the portable archive memory bound, regular restore drills, compliance retention, or egress/operation volume beyond provider grants.
