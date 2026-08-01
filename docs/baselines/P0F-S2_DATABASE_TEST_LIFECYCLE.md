# P0F-S2 isolated PostgreSQL test lifecycle

Date: 2026-08-01  
Runtime: Docker 29.6.2, `postgres:16.14-bookworm`, loopback ephemeral port, tmpfs data directory, `--rm`

## Isolation contract

`npm run test:database:integration` now connects only through an explicit `DATABASE_ADMIN_URL` whose protocol is PostgreSQL, host is loopback, database is exactly `postgres`, user is explicit and safety scope is `disposable`. A bounded non-production prefix plus 12 random hex characters creates one source name ending `_ci` and one independent restore name ending `_restore_ci`.

The lifecycle creates the source once, runs all child processes with only generated target URLs, and enters cleanup for every success or failure. Cleanup force-drops the two exact validated identifiers and independently queries `pg_database` to prove neither remains. CI no longer publishes a fixed mutable `DATABASE_URL` or relies on state from an earlier workflow step.

## Ordered per-run work

1. Create a unique source database.
2. Apply all six checksum-pinned Prisma migrations.
3. Seed the 34-permission, 14-role, 95-grant authorization catalog twice.
4. Run real constraint, import, file, repository, parity, activation and rollback integration coverage.
5. Create a separate restore database, perform an authenticated portable restore and reject replay into the non-empty target.
6. Drop both exact databases in `finally`, query catalog absence, close the administrative connection and let CI/Docker remove the service.

## Real PostgreSQL evidence

| Assertion              | Observed result                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Migrations             | All 6 applied and recorded finished/not rolled back                                                                       |
| Schema                 | 63 source base tables including Prisma metadata; portable snapshot covers 62 application tables                           |
| Seed idempotence       | Both seed executions returned 34 permissions, 14 roles and 95 grants; no human/superadmin seed                            |
| Restricted content     | Invalid conversation response format and note content format rejected by named checks                                     |
| Idempotency lease      | Unpaired lease and completed response with an active lease rejected by named checks                                       |
| Legacy fixture import  | 27 source records: 15 imported, 9 quarantined, 3 skipped; replay idempotent                                               |
| Transactional adapters | Identity rotation/reuse, organization ownership and authority audit behavior passed                                       |
| Cutover                | Identity/organization/authority activation verified, then rollback verified                                               |
| Files                  | Lifecycle/reconciliation passed; orphan promotion remained blocked                                                        |
| Recovery               | Authenticated 280-row/62-table restore passed; second restore into non-empty target rejected                              |
| Cleanup                | Harness and independent `pg_database` query found no generated names; exact tmpfs/`--rm` container stopped and was absent |

The first constraint-test authoring run safely failed because its fixture used an already-invalid conversation context and therefore hit the older context check before the new format check. The lifecycle still removed both targets. The fixture was corrected to a valid `general` context, and the complete lifecycle then passed.

## Non-database regression evidence

Five lifecycle safety tests cover remote/production/maintenance-database/prefix/identifier rejection, bounded unique names, connection-option preservation, exact create/drop counts and cleanup verification. The repository database contract confirms that CI invokes the isolated lifecycle on PostgreSQL 16.14. The full server suite is now 158 tests.

During the subsequent full check, the new client focus test exposed a timing-only assertion against `requestAnimationFrame`; it now awaits the focus transition and passed 10 consecutive focused runs. This was a test synchronization fix, not a product behavior change.

## Completion rule

P0F-S2 is complete when one command owns database creation through verified cleanup, every migration and both seeds execute on a fresh target, real constraint/repository/migration/recovery coverage passes, CI uses the same lifecycle and no production or persistent database is contacted. The recorded rehearsal satisfies this rule.
