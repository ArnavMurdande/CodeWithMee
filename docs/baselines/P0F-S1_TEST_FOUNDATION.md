# P0F-S1 test foundation evidence

Date: 2026-08-01  
Scope: deterministic client component, server API/service and external-adapter tests

## Runner boundary

- Client components run with exact `vitest@4.1.10` and `jsdom@30.0.1` versions. Vitest reuses the production Oxc JSX transform through `client/config/sourceJavaScriptAsJsx.ts`; no second application compiler path exists.
- Server API and service tests retain Node's built-in runner. The existing 148 tests were not replaced; five deterministic foundation tests raise the suite to 153.
- Repository contract tests use Node's built-in runner and now include four P0F-S1 checks, raising that suite from 61 to 65.
- Client setup uses the non-routable `https://codewithmee.test/` origin, deterministic `matchMedia`, automatic DOM cleanup and a global `fetch` stub that throws on every unmocked network request.

## Deterministic fixtures and fakes

| Boundary        | Implemented test seam                                                                          | Fail-closed behavior                                                     |
| --------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Identity/domain | Fixed clock, stable sequence, user and checksum-pinned file factories                          | Invalid clocks/advances reject; generated data uses `.invalid` addresses |
| AI              | Scripted `generate` results and captured structured requests                                   | Unscripted calls throw; no provider SDK or credential                    |
| Video           | Scripted `search` results and captured structured requests                                     | Unscripted calls throw; no video provider/network                        |
| Code runner     | Scripted `execute` results and captured structured requests                                    | Unscripted calls throw; no local process/container/network execution     |
| Email           | In-memory message capture with stable provider IDs                                             | No provider, SMTP connection, token or secret                            |
| Object storage  | In-memory private bucket, upload intent, byte-size/SHA-256 enforcement, deterministic presigns | Missing intent/object or metadata mismatch throws; URLs use `.invalid`   |

Captured inputs are structured-cloned so callers cannot mutate historical assertions. These fakes are test support only and are not imported by production composition.

## Real component coverage

The initial five behavioral tests cover loading/error/empty asynchronous UI, retry semantics, the portal-based shared dropdown, keyboard selection and Escape handling, dialog Escape handling and focus restoration. Static accessibility and product-surface tests remain complementary; they are not counted as DOM behavior.

## Verification

| Check                         | Result                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Aggregate `npm.cmd run test`  | 65 tooling, 153 server and 5 client tests pass                                                               |
| Strict root/client type-check | Pass after typing every P0E/P0F tooling script                                                               |
| Root lint                     | 0 errors; client/tooling 0 warnings; 35 recorded legacy server warnings                                      |
| Production build              | 210 client modules and 168 server files pass; all client budgets remain below limits                         |
| Formatting                    | All repository-listed files pass Prettier                                                                    |
| Dependency audit              | Root/server production: 0; client full/production: the same 2 known high React Router advisories, 0 critical |

No live AI, video, email, storage, runner, database, production identity or browser account was contacted. PostgreSQL lifecycle execution belongs to P0F-S2; browser E2E belongs to P0F-S3.

## Completion rule

P0F-S1 is complete when the pinned DOM runner executes real components, client tests reject unmocked I/O, all five external domains have deterministic fail-closed fakes, existing server/API coverage remains green and the aggregate repository test command succeeds. This evidence satisfies that rule without claiming database or browser E2E execution.
