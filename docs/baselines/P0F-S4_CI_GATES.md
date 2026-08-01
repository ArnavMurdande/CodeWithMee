# P0F-S4 CI quality and security gate evidence

Date: 2026-08-01  
Status: locally verified; first GitHub-hosted execution remains external evidence

## Objective and reused foundation

P0F-S4 turns the existing deterministic root commands, OpenAPI artifact, isolated PostgreSQL lifecycle and Playwright suite into enforceable pull-request/main-branch gates. It reuses exact lockfiles, Node 24.18.0, the 80 repository tests, 158 server tests, 5 client tests, 5 browser flows and the separate database workflow rather than creating a second build path.

## Implemented gate topology

| Gate | Implementation and acceptance |
| --- | --- |
| Format/lint/type/test/build | The `quality` job installs all three exact lockfiles, then runs named formatting, lint, strict type, 80/158/5 test and production-build steps. Existing 35 server warnings remain visible; any error fails. |
| OpenAPI | `openapi:check` compares the executable document byte-for-byte with the committed OpenAPI 3.1.1 artifact and reports 37 paths/41 operations without writing. |
| Dependency | `audit:check` runs live npm audit in all three workspaces. Root/server require zero findings. Client permits only advisory source 1124282/GHSA-qwww-vcr4-c8h2 through the exact `react-router` graph until 2026-09-30; unknown, changed, expired and stale exceptions fail. |
| License | All 682 npm lock entries must use the reviewed license set. GSAP 3.15.0 and three exact packages whose lock metadata omits their bundled license use dated, reasoned exceptions; strong copyleft, unknown, missing, changed, expired and stale entries fail. |
| Secrets | 370 repository text files are scanned for known provider token shapes, private keys, hardcoded sensitive assignments and non-synthetic credentialed database URLs. Four recognized binary files are classified by extension; oversized unknown text fails. Test fixture paths still receive provider-token/private-key matching. |
| Containers | Every workflow/Compose image must use a sha256 digest. Dockerfiles additionally require digest-pinned bases and a non-root final user and reject remote ADD, pipe-to-shell, host network, privilege and Docker-socket access. The current repository has no deployable Dockerfile and one pinned PostgreSQL image. |
| Workflow supply chain | External actions require a 40-character commit SHA, checkout disables persisted credentials, top-level access is `contents: read`, every runnable job has a timeout and `pull_request_target`/broad permission presets are rejected. |
| Browser | A dependent job installs exact root/client dependencies and Chromium, runs all five protected production-preview flows, and retains only seven-day failure traces/screenshots. |
| Database | The independent database workflow uses the same isolated P0F-S2 lifecycle against `postgres:16.14-bookworm` pinned to `sha256:92620d...f55`. |
| SAST | A least-privilege CodeQL JavaScript/TypeScript job uses exact v4.36.0 commit SHAs for initialization and analysis. Its first GitHub-hosted result cannot be claimed locally. |

The workflow action pins are checkout v6.0.2 (`de0fac2...83dd`), setup-node v6.0.0 (`2028fbc...903`), upload-artifact v5.0.0 (`330a01c...c38`) and CodeQL v4.36.0 (`f52b05f...9ef`). Automatic package-manager caching is disabled on these security gates.

## Changes and boundaries

- Database: no schema or data change. The CI PostgreSQL service remains disposable and its application targets are random.
- Backend/frontend: no production behavior change. The client package now declares the repository's MIT license; no runtime dependency was added.
- Deployment: two workflows and repository-only policy scripts were added. Nothing was deployed, pushed, provisioned or connected to production credentials.
- Security: checks enumerate the worktree/CI checkout, not Git history. CodeQL and GitHub-hosted runner behavior require the first remote workflow result. With no application image, container vulnerability/SBOM/signing gates remain Phase 6B work.

## Verification

| Check | Result |
| --- | --- |
| CI-gate regressions | 10/10 pass; tooling aggregate 80/80. |
| Full `npm.cmd run check` | Pass: format, lint (0 errors/35 recorded warnings), strict types, 80/158/5 tests, 212-module build and all six repository-native policy commands. |
| Policy inventory | OpenAPI 37/41; audit 2 nodes/1 exact exception; license 682/4 exceptions; secrets 370 text/4 binary; containers 0 Dockerfiles/1 digest; workflows 2/4 jobs/10 pinned action uses. |
| `npm.cmd run test:e2e` after CI changes | 5/5 pass with zero retries; production performance measurements remain within budgets. |

## Risks and safe fallback

Hosted minutes, action availability and CodeQL upload permissions can fail outside the repository. A missing scanner/browser/service is a failed or unavailable release signal, never an implicit pass. The safe fallback is a private local build with this evidence recorded as local-only; do not use production credentials, weaken exact exceptions, float an action/image tag, publish a container, or call the product Phase 0-ready until the required remote statuses pass.

## Definition of completion

P0F-S4 implementation is complete when every requested gate has one named, fail-closed workflow step; supply-chain references and image references are immutable; exceptions are exact, dated and regression-tested; database/browser jobs preserve their isolation; and the complete local equivalent passes. This definition is met. The first GitHub-hosted CodeQL/workflow result is explicitly external activation evidence, not fabricated by this record.
