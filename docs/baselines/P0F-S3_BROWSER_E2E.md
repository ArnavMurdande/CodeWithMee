# P0F-S3 protected browser E2E evidence

Date: 2026-08-01  
Runner: `@playwright/test@1.62.1`, Chromium headless shell v1234 / Chrome for Testing 151.0.7922.34, `@axe-core/playwright@4.12.1`

## Isolation boundary

The production Vite build is served on `http://127.0.0.1:4173`. Every `/api/**` request is intercepted by an in-process fixture with `.invalid` users and a non-secret access token. An unconfigured API request returns a synthetic `503` and fails the test. Any HTTP(S) origin other than the local preview fails the test, except the exact Monaco 0.56 CDN path: those requests are intercepted and fulfilled from the exact installed package on disk, so no CDN request leaves the browser.

Unexpected page errors, page-level horizontal overflow, a missing/duplicate main landmark, unmatched APIs and unmanaged origins all fail. Traces and screenshots exist only on failure, video is disabled, service workers are blocked, retries are zero and passing output contains no user data.

## Executed flows

| Flow | Evidence |
| --- | --- |
| Auth | Cold refresh receives synthetic `401`; labeled local sign-in sends the expected fixture request and reaches the protected dashboard without persistent credentials. |
| Responsive navigation | At 360 x 740 the mobile navigation is visible, desktop navigation is hidden, the Challenges link opens the catalog and the page has no global horizontal overflow. |
| Profile | Current-principal name/email populate the form; username update crosses the fixture API and reports success. |
| Challenge read | Catalog data loads, a semantic title button opens the statement, constraints and visible example; no submission request occurs. |
| Provider/role | A superadmin reads pending/approved provider reviews. A learner in a separate browser context is redirected from `/admin` to `/dashboard` and never sees the provider console. |

All five tests run WCAG 2.0/2.1 A/AA axe rules and block every serious or critical violation. The provider test audits both its superadmin and learner pages, for six analyzed page states total.

## Findings closed by the browser run

- Removed all Imgur avatar fallbacks from Header, Profile and Space in favor of a local generic SVG.
- Converted the challenge title cell click target to a keyboard-native named button.
- Added the missing dynamic accessible name to the save-challenge icon button.
- Darkened approved/success administration badges after axe measured only 3.05:1 contrast on the approved badge.
- Pinned the Monaco compatibility URL to exact `0.56.0` and overrode its vulnerable exact DOMPurify child with `3.4.12`; client audit returned to only the two known Router advisories.
- Corrected the selector that confused “Primary navigation” with “Mobile primary navigation” and used a separate browser context for the learner role fixture.

The first actual Playwright run passed 2/5 and surfaced the product/test-boundary failures above. After correction, two consecutive complete executions passed 5/5. The Vite preview stopped automatically; port 4173 had no listener afterward. Only ignored `.last-run.json` remained in `test-results`.

## Verification

| Check | Result |
| --- | --- |
| E2E contract tests | 5/5 pass |
| Strict E2E/client/tooling type-check | Pass |
| E2E/client lint | Zero errors/warnings |
| Playwright execution | 5/5 pass twice consecutively |
| Production build | 212 modules; initial JS 168,657 B gzip, Home 176,595 B, Auth 170,538 B, CSS 26,879 B, largest raw asset 408,057 B, total raw build 843,693 B |
| Dependency audit | Root full 0; client full/production only 2 known high React Router advisories, 0 critical/moderate/low |

## Completion rule

P0F-S3 is complete when the five named journeys run in Chromium against production assets, protected identities and APIs are deterministic/non-production, role denial is explicit, serious/critical axe findings and runtime/network errors block, and runs leave no live preview. This evidence satisfies that rule.

It does not claim real-backend E2E, full route-matrix coverage, moderate/minor axe remediation, cross-browser/screen-reader interoperability or offline/self-hosted Monaco. Those remain explicit P0F-S4/P0F-S6 and Phase 5/6 gates.
