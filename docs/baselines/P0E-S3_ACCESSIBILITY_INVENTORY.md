# P0E-S3 Accessibility Inventory

Date: 2026-08-01  
Scope: active learner, social, provider-compatibility and administration client source

## Resolved findings

| Surface               | Finding                                                                                                                                          | Resolution                                                                                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Select menus          | Four route-local dropdown implementations used clickable list items and incomplete keyboard behavior.                                            | All route wrappers now delegate to `AppDropdown`, whose native trigger/options expose menu and selected-radio semantics, Arrow Up/Down, Home/End, Escape/Tab handling and focus restoration.            |
| Dialogs               | Route overlays lacked a consistent dialog name, Escape path, focus containment and focus restoration.                                            | `AccessibleDialog` now owns the modal contract and is used by challenge solution, pathway saved views, private enrollment, Space profiles, provider course builder and focus-timer notifications.       |
| Interaction semantics | Dashboard cards, navigation cards, comments, profile openers, file rows and section selectors included clickable `div`, `span` or `li` elements. | Actions are native buttons. Section selectors are labeled button groups with `aria-pressed`; they deliberately do not claim the ARIA tab pattern without its arrow-key contract.                        |
| Focus                 | Route styles suppressed outlines with selectors that overrode the global focus ring.                                                             | All `outline: none` rules were removed. The shared `:focus-visible` contract is the sole focus-ring baseline.                                                                                           |
| Motion and contrast   | Ambient cursor/background animation ignored motion preference and high-contrast colors had no explicit fallback.                                 | Global reduced-motion rules collapse animation/transition timing; animated background setup exits early; decorative cursor/media are hidden from assistive naming; higher-contrast tokens are supplied. |
| Media                 | Direct video/audio elements had no shared caption/transcript policy.                                                                             | `AccessibleMedia` is the only direct media renderer. It accepts real caption/transcript data and truthfully states when legacy media lacks them; no captions are fabricated.                            |
| Forms and editors     | Search/comment/course/challenge/timer/note controls and Monaco instances had incomplete assistive names.                                         | Labels, `aria-label`, live status/alert roles, editor `ariaLabel` values, timer expansion state and note textbox semantics were added.                                                                  |
| Mobile notes          | Text notes were available after P0E-S2 but editor and drawing surfaces lacked explicit semantics.                                                | The editor is a named multiline textbox. The canvas is named as a pointer-required drawing surface; text notes remain the keyboard-safe fallback.                                                       |

## Automated contract

`scripts/tests/client-accessibility.test.mjs` prevents recurrence of non-semantic click targets, unnamed shared dropdowns, incomplete menu/dialog contracts, unwrapped media, focus-outline suppression, missing motion/contrast primitives and unnamed high-value form/editor controls.

## Truthful verification boundary

- Verified: source contracts, ESLint parse/static rules, TypeScript boundary, exact Prettier formatting and Vite production compilation.
- Not claimed: browser axe output, assistive-technology interoperability, protected-route keyboard walkthroughs, contrast pixel sampling or cross-browser behavior. Those require the P0E-S6/P0F browser/component harness and deterministic identities/data.
- Caption fallback: retain the explicit unavailable notice until a rights-cleared caption/transcript asset exists.
- Drawing fallback: keep plaintext note editing available; do not claim keyboard drawing support for the pointer canvas.

## Evidence

| Check                                  | Result                                                                                               |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `npm.cmd run test:tooling`             | 47/47 pass                                                                                           |
| `npm.cmd run lint:client`              | 0 errors; 78 existing warnings                                                                       |
| `npm.cmd run typecheck:client`         | Pass                                                                                                 |
| Exact Prettier check over P0E-S3 files | Pass                                                                                                 |
| `npm.cmd run build:client`             | Pass; 232 modules, 721.17 kB JS, 145.41 kB CSS; known chunk and 17.77 MB promo-media warnings remain |
