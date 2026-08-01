# ADR 0003: Layered backup verification and non-destructive legacy retirement

- Status: Accepted
- Date: 2026-08-01
- Roadmap item: `P0C-S6`

## Context

CodeWithMee needs a recovery proof before PostgreSQL or private objects can become authoritative. The local environment has no `pg_dump`, `pg_restore`, managed PITR target, or configured S3-compatible provider. Mongo and local uploads must remain available for cutover rollback, but indefinite dual authority or an automatic cleanup command would create data-loss risk.

## Decision

Production recovery is layered: managed PostgreSQL PITR plus encrypted native custom-format backups are primary, object versions/inventory protect bytes, and a bounded AES-256-GCM application-data archive supplies a repository-owned cross-provider restore verifier. The portable archive binds all application rows to the exact schema checksum and ordered migrations, restores only to a distinct migrated target, and compares a complete content digest inside the restore transaction.

File reconciliation is read-only and HMAC-referenced. Legacy retirement is an executable readiness assessment, never a deletion command. Mongoose, Mongo data, and local uploads cannot be removed until all domains use PostgreSQL, the rollback window expires, parity/restore/file reports pass, local serving is retired, and legal hold is cleared. A separately approved destructive change remains mandatory.

## Consequences

- Free/local environments can verify recovery without native client binaries, while production must still fund PITR and isolated backups.
- The portable archive intentionally has a 256 MiB plaintext bound and is not a large-scale streaming backup.
- Object bytes require provider versioning/replication; database metadata alone is insufficient.
- Ambiguous legacy files block retirement and are quarantined/reconciled rather than inferred or deleted.
- New schema cycles or migration-created rows fail restore until explicitly reviewed in the restore contract.

## Rejected alternatives

- Treating a successful export as a backup without restoring it: no recovery proof.
- Keeping ad hoc dual writes during retirement: conflicting authority and unbounded reconciliation.
- Automatically deleting storage or Mongo records from an orphan report: unsafe under incomplete mappings and eventual consistency.
- Using the portable archive as the sole production backup: no PITR, streaming, cross-account isolation, or object-byte protection.
