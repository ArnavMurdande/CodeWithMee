# MongoDB to PostgreSQL migration tooling

This directory implements the P0C-S2 read-only inventory, encrypted export and import dry-run boundary. It never reads `MONGO_URI`; a live source requires the separate `MIGRATION_SOURCE_MONGO_URI`, `MIGRATION_SOURCE_MODE=read_only`, exact `MIGRATION_SOURCE_APPROVAL=read-only:<database>`, and an authenticated Mongo role limited to `read`/`readAnyDatabase` plus optional `clusterMonitor`.

Two independent 32-byte base64 keys are expected:

- `MIGRATION_EXPORT_KEY` encrypts every collection file with AES-256-GCM. The key is never written to the snapshot.
- `MIGRATION_FINGERPRINT_KEY` HMAC-fingerprints source IDs, database/path labels and owner hints in operator-safe reports.

Do not commit either key or any generated output. Output directories are created exclusively and files use owner-only modes where the platform supports them. The repository ignores `migration-output/` and `.migration-private/`; a separately protected location is preferred for live snapshots.

Examples (arguments after `--` are forwarded by npm):

```bash
npm run migration:inventory -- --source auto --uploads server/uploads --output migration-output/inventory-run
npm run migration:export -- --source mongo --output .migration-private/source-snapshot
npm run migration:dry-run -- --snapshot .migration-private/source-snapshot --output migration-output/dry-run
```

`--source auto` produces an explicit unavailable-source inventory when no migration-specific URI is configured; it does not fall back to the application URI. `--source fixture --fixture <file>` is the deterministic test/rehearsal adapter. This source-side `import` command always requires `--dry-run`; reviewed target writes use the separate, guarded `npm run migration:import -- --apply ...` command and never reopen MongoDB.

Reports contain counts, schema fields, checksums, HMAC fingerprints and generic exception codes—not raw emails, passwords, tokens, source IDs or upload paths. Every legacy challenge test is marked visible in the dry-run plan until an author reviews it. Ambiguous company admins, duplicate emails, dangling references, unrecognized credential hashes and paid courses without currency are quarantined rather than guessed.
