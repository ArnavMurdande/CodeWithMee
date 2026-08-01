# CodeWithMee Phase 0 release gate

**Gate date:** 2026-08-01  
**Phase 1 implementation:** GO after `npm run phase0:gate` passes  
**Public/production launch:** NO-GO

## Evidence required to begin Phase 1

`npm run phase0:gate` requires all 35 roadmap prerequisites from P0A-S1 through P0F-S5 to be `VERIFIED` and requires the seven canonical plans plus P0F-S1–S5 evidence files. The full local proof is:

1. `npm ci`, `npm --prefix client ci`, `npm --prefix server ci`.
2. `npm run check` — format, lint, strict types, 81 tooling tests, 162 server tests, 5 client tests, production build, OpenAPI/audit/license/secret/container/workflow/Phase 0 policy.
3. `npm run test:e2e` — 5 protected Chromium flows with axe and deny-by-default network fixtures.
4. `npm run test:database:integration` with the P0F-S2 disposable loopback PostgreSQL environment — all six migrations, recovery and exact cleanup.
5. `npm run phase0:gate` — documentation/status gate.

The repository is architecturally ready for sequential Phase 1 implementation when those commands pass. P0F-S6 publishes this decision; it does not convert known future work into completed product features.

## Why production remains blocked

- Challenge learner DTOs still expose reference solutions/hidden tests and execution lacks the Phase 1B isolated job plane.
- Runtime feature domains still default to Mongoose; no authorized live migration/parity/cutover or managed PostgreSQL exists.
- No real private bucket/scanner, Google OAuth, transactional email, runner, monitoring exporter, branch-protection status, managed backup/PITR or deployment exists.
- The client retains two reviewed high React Router audit nodes and the production Monaco compatibility path still uses jsDelivr.
- Full keyboard/screen-reader/caption evidence, moderate/minor axe remediation and real-backend/cross-browser E2E remain incomplete.
- Legacy social/course/progress/payment/credit authorization and transaction rules remain unsafe for public or commercial claims.

The safe posture is local/private development with unavailable integrations shown truthfully. Do not publish paid/private courses, public UGC, hidden challenge tests, code execution or certification claims.

## External activation checklist

- Run `quality`, `browser`, `codeql` and `migrate` on GitHub-hosted infrastructure and make all four required branch checks.
- Resolve any CodeQL result; do not waive security tests through skip/continue-on-error.
- Configure only synthetic staging credentials, then run real-backend auth, storage, email, database, recovery and browser smoke.
- Keep production activation under Phase 6 and its named operational owner, RPO/RTO, budget, moderation and incident gates.

## P0F-S6 completion

The Phase 0 evidence index, executable Phase 1 block, local verification procedure, production NO-GO reasons, external gates and safe posture are explicit. Phase 1 may now be implemented in roadmap order; production remains blocked until Phase 6 acceptance.
