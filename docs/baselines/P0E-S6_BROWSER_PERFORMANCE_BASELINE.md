# P0E-S6 browser, responsive, accessibility, and performance baseline

Date: 2026-08-01  
Status: verified within the explicit anonymous/public browser boundary

## Implemented regression contract

`client/tests/regression/p0e-s6.scenarios.json` is the stable handoff from Phase 0E to the isolated browser runner in Phase 0F. It covers all 15 route patterns, the five required viewport classes, anonymous/learner/author/challenge/superadmin fixtures, reduced motion, higher contrast, and six keyboard/focus workflows. A scenario names its data/role fixture and assertions; protected content must never be captured using production data.

Every route module is now loaded with `React.lazy` behind a semantic `Suspense` loading state. `route-styles.css` eagerly owns route CSS ordering so the final `responsive.css` compatibility layer still wins after JavaScript splitting. Page/component modules no longer emit duplicate lazy CSS. The Auth route now uses a top-level H1. Animated H1/H2 content has a stable accessible name from first paint while the visual typing span is assistively hidden.

## Production browser evidence

Environment: local Vite production preview at `http://127.0.0.1:4173`, inspected through the Codex in-app Chromium browser with an explicit viewport override. No sign-in, production identity, production database, external transmission, or deployment was used.

### Home route

| Viewport   | Document width | Page overflow | Main |  H1 | Stable H1/H2 names | Unnamed buttons/links | Video/audio/frame |
| ---------- | -------------: | ------------- | ---: | --: | ------------------ | --------------------: | ----------------: |
| 360 x 740  |            360 | No            |    1 |   1 | Yes                |                     0 |                 0 |
| 390 x 844  |            390 | No            |    1 |   1 | Yes                |                     0 |                 0 |
| 768 x 1024 |            768 | No            |    1 |   1 | Yes                |                     0 |                 0 |
| 1024 x 768 |           1024 | No            |    1 |   1 | Yes                |                     0 |                 0 |
| 1440 x 900 |           1440 | No            |    1 |   1 | Yes                |                     0 |                 0 |

The 360 px screen was visually inspected. Off-screen carousel cards remain clipped inside their owned component and do not enlarge the page. The initial DOM snapshot exposed the typing-cursor-only heading defect; the corrected snapshot reports `Code With Mee`, `A New Way to Learn`, `All-In-One Toolkit`, `Our Mission`, and `Ready to Start Your Journey?` as stable heading names before visual typing completes.

The production page-asset inventory found 6 observable assets: 3 scripts, 1 stylesheet, 1 image and 1 other resource. It found no external origin and no video asset.

### Auth route

At 360 x 740 the Auth route has document width 360, no page overflow, one main landmark, one H1 (`Welcome back`), and all inputs have associated labels. The remaining declared Auth viewports are preserved in the automated scenario matrix for the Phase 0F runner.

### User preferences

With browser-emulated `prefers-reduced-motion: reduce` and `prefers-contrast: more`, both media queries matched. Reviewed animation iteration values were bounded to one, canvas content remained assistively hidden, and route content remained present. The decorative cursor node may remain mounted but is assistively hidden and governed by the reduced-motion CSS contract.

## Executable performance budgets

Every `npm run build` in `client/` now emits `.vite/manifest.json` and runs `scripts/check-client-performance.mjs`. The checker computes transitive entry/home/Auth graphs, gzip transfer bytes, request count, largest raw artifact and total raw build bytes; a threshold breach exits non-zero.

| Metric                            |  Measured |      Budget |    Headroom |
| --------------------------------- | --------: | ----------: | ----------: |
| Initial JavaScript, gzip          | 168,464 B |   225,280 B |    56,816 B |
| Initial CSS, gzip                 |  26,859 B |    40,960 B |    14,101 B |
| Initial requests                  |         3 |           8 |           5 |
| Home route JavaScript graph, gzip | 176,403 B |   245,760 B |    69,357 B |
| Auth route JavaScript graph, gzip | 170,343 B |   235,520 B |    65,177 B |
| Largest raw asset                 | 407,564 B |   524,288 B |   116,724 B |
| Total raw build                   | 839,136 B | 2,097,152 B | 1,258,016 B |

The final Vite build transformed 210 modules. It emits one 140.88 kB raw/26.94 kB gzip stylesheet, a 407.56 kB raw/134.51 kB gzip entry chunk, a 98.02 kB raw/35.51 kB gzip API chunk, and bounded lazy route chunks. The prior 689 kB monolithic JavaScript artifact and 17.77 MB promo artifact are no longer emitted.

## Verification boundary and fallback

The localhost browser security policy blocked low-level keyboard injection and developer-log probing. No alternate browser, CDP workaround, or policy circumvention was attempted. Authenticated/provider/admin screenshots also require deterministic non-production identities, API fakes and isolated data that do not exist until P0F-S1/P0F-S3. No axe engine or screen reader was run in P0E-S6.

Those gaps do not disappear: the scenario matrix makes them explicit acceptance work for Phase 0F. Until that runner exists, source contracts enforce keyboard/dialog/dropdown/focus semantics, the browser evidence covers public layout and accessible-name behavior, and protected routes remain private. Screenshot goldens should run with animations disabled and reviewed fixtures; if visual comparison is unstable, use semantic/layout assertions plus a small reviewed screenshot set rather than weakening security or silently skipping tests.

P0E-S6 is complete when the scenario and budget gates remain executable, the production public browser baseline passes at the declared widths/preferences, and the unexecuted authenticated/keyboard/axe cases remain explicitly owned by Phase 0F rather than claimed as passed.
