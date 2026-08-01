# Phase 0A Baseline — First Implementation Run

**Captured:** 2026-08-01  
**Repository root:** `C:\Users\Arnav\Desktop\CWM\CodeWithMe`  
**Branch:** `main`  
**HEAD:** `012f3142b2f4074e0e65fcc4ff404f28c2680e21`

## Preservation boundary

The dirty tree predates this implementation slice and is user-owned. No tracked or untracked product source was reset, stashed, cleaned, moved, deleted or overwritten. Phase 0A work may touch only previously clean root configuration, new audit/progress files, or a user-modified file after its diff is explicitly inspected.

Current status at capture:

```text
 M client/src/App.js
 M client/src/components/Header.css
 M client/src/components/Header.js
 M client/src/components/MobileWarningOverlay.js
 M client/src/components/NotesWidget.css
 M client/src/components/NotesWidget.js
 D client/src/components/ScrollingSlider.css
 D client/src/components/ScrollingSlider.js
 D client/src/components/Sidebar.css
 D client/src/components/Sidebar.js
 M client/src/context/AuthContext.js
 M client/src/pages/Auth.css
 M client/src/pages/Auth.js
 M client/src/pages/ChallengeSolver.js
 M client/src/pages/Challenges.css
 M client/src/pages/Challenges.js
 M client/src/pages/Dashboard.css
 M client/src/pages/Pathways.css
 M client/src/pages/Pathways.js
 M client/src/pages/Profile.js
 M client/src/pages/Sandbox.css
 M client/src/pages/Sandbox.js
 M client/src/pages/Settings.js
 D client/src/prism-setup.js
 M server/index.js
 D server/models/Submission.js
 M server/models/User.js
 M server/routes/ai.js
 M server/routes/auth.js
 M server/routes/challenges.js
 M server/routes/user.js
?? client/src/components/AppDropdown.css
?? client/src/components/AppDropdown.js
?? client/src/components/ScrollTrackRow.css
?? client/src/components/ScrollTrackRow.js
?? client/src/pages/Courses.css
?? client/src/pages/Courses.js
?? client/src/pages/Space.css
?? client/src/pages/Space.js
?? client/src/pages/admin/
?? client/src/pages/company/
?? docs/
?? server/models/Company.js
?? server/models/CompanyEmployee.js
?? server/models/Course.js
?? server/models/Enrollment.js
?? server/models/Post.js
?? server/models/Project.js
?? server/routes/admin.js
?? server/routes/courses.js
?? server/routes/space.js
?? server/uploads/notes/
?? server/uploads/user-69838a55d6bd429dd5ce0156-1774552350565.jpeg
?? server/uploads/user-69838a55d6bd429dd5ce0156-1774552355824.jpg
?? server/uploads/user-69a89050611d56b05e19b246-1774586797395.jpg
?? server/uploads/user-69a89050611d56b05e19b246-1774587090094.jpeg
?? server/uploads/user-69b3a1ec170919a43355283d-1774902788093.jpg
?? server/uploads/user-69c583ccc185e9552bc28911-1774552039645.jpg
?? server/uploads/user-69c583ccc185e9552bc28911-1774552376941.jpg
?? server/uploads/user-69c583ccc185e9552bc28911-1774552942133.jpg
?? server/uploads/user-69c583ccc185e9552bc28911-1774552968910.jpg
?? server/uploads/user-69c583ccc185e9552bc28911-1774553830101.jpeg
```

## Runtime and package baseline

- Node.js: `v24.18.0` (Node 24 LTS).
- npm: `11.5.2`.
- Docker: `29.6.2`.
- Docker Compose: `v5.3.1`.
- Docker caveat: CLI discovery succeeded, but the sandbox cannot read the user's Docker config file.
- Root package: one unused `@google/genai` dependency and no scripts.
- Client: React 19/CRA/react-app-rewired; independent lockfile.
- Server: Express 5/Mongoose; independent lockfile.
- Database config: only the `MONGO_URI` key name was inventoried; no value or connection was read.
- PostgreSQL and object-storage configuration: absent.

## Upload snapshot

The local `server/uploads` tree contains **0 files** totaling **null bytes**: **0 tracked** and **0 untracked** at capture.

The companion `P0A-S1_UPLOAD_MANIFEST.csv` records a SHA-256 fingerprint of each relative path, directory class, extension, Git state, byte size and content SHA-256. Original user-derived filenames are intentionally not copied into documentation. The repository paths remain the authoritative local mapping.

## Baseline smoke results

- Client non-CI production build previously passed with warnings on 2026-07-31.
- Client CI production build on 2026-08-01 failed because CRA promotes the existing 35 ESLint warnings to errors.
- Standalone client ESLint on 2026-08-01 exited 0 with 35 warnings and 0 errors.
- Client test on 2026-08-01 exited 1 because no tests exist.
- Server syntax sweep on 2026-08-01 checked 23 JavaScript files and passed.
- Full output and environment boundaries are recorded in `../TEST_RESULTS.md`.

## No-overwrite migration checklist

Before any path move, framework migration or data cutover:

- [ ] Re-run `git status --short` and compare with this baseline.
- [ ] Inspect the diff of every file the slice will touch.
- [ ] Confirm whether each untracked source/upload is user work, generated output or disposable cache.
- [ ] Back up untracked uploads outside the migration target before any object-storage import.
- [ ] Recompute upload count, sizes and hashes; investigate every mismatch.
- [ ] Keep current `client/` and `server/` runnable until parity checks pass.
- [ ] Add new configuration alongside legacy configuration; do not remove compatibility paths prematurely.
- [ ] Use expand-migrate-contract and feature flags for schema/API cutovers.
- [ ] Record commands, exit results, affected files and rollback action in the evidence registers.
- [ ] Never delete MongoDB data or local uploads before parity, backup and restore evidence.
- [ ] Stop if a planned edit overlaps an unexplained user change.

## Rollback for this baseline task

This task adds documentation only. Removing the new baseline/progress documents returns the production tree to its prior state; no application or user data rollback is required.

