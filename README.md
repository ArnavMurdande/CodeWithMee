# CodeWithMee 🚀  
**AI-Powered Interactive Coding Learning Platform**

CodeWithMee is an AI-powered learning operating system that transforms passive coding education into an active, collaborative, and development-driven experience. Instead of just watching tutorials, users practice in a live sandbox, receive AI guidance, and build real projects inside a social ecosystem.

---

## 📌 Project Overview

CodeWithMee combines learning, development, and collaboration into a single environment.

The platform integrates:

- 🧠 AI mentor with contextual coding assistance
- 💻 Interactive split-screen coding sandbox
- 📚 AI-generated learning roadmaps
- 🤝 Social and collaborative learning features
- 🏗️ AI-powered project scaffolding
- 🎮 Gamification and engagement systems

The goal is to function as a **learning operating system**, not just a website.

---

## ✨ Key Features

### 🤖 AI-Powered Roadmap Generation
Generate personalized step-by-step learning paths based on language and skill level.

### 💻 Interactive Learning Sandbox
Split-screen environment where users can:

- watch YouTube tutorials
- write code simultaneously
- execute Python code in real time
- view output instantly

Powered by Monaco Editor + backend execution engine.

### 🧠 Persistent AI Assistant (“Mee”)
Context-aware AI mentor that:

- explains code
- helps debug logic
- answers questions
- generates learning roadmaps
- provides guided assistance during practice

### 🔐 Secure User System
- unified human identities with local and Google providers under `/api/v1`
- Argon2id passwords with verified bcrypt upgrade on login
- short access tokens plus rotating, hashed refresh-token families
- email verification/reset and owner-visible session revocation contracts
- all protected server handlers validate the current unified principal; legacy credential/company-provider routes return migration responses
- the web keeps access tokens in memory, refreshes with cookie-bound CSRF protection and never restores legacy persistent tokens; the already-issued learner bridge is local-only, default-off and production-blocked

### 🎨 Modern UI/UX
- animated dashboard
- motion-driven interface
- custom cursor & visual effects
- Pomodoro timer
- developer-style workspace

---

## 🏗️ Core Architecture

CodeWithMee follows a modular MERN architecture:

**Frontend**
- React + Vite
- Monaco Editor
- GSAP animations

**Backend**
- Node.js
- Express.js

**Database**
- MongoDB

**Authentication**
- Argon2id, short JWT access tokens, rotating HttpOnly refresh cookies, Google OIDC + PKCE

**AI Engine**
- Google Gemini API

**Code Execution**
- Current development adapter calls a Piston-compatible HTTP endpoint
- Isolated production execution is planned; the web/API process does not execute Python locally

**Future Layer**
- VS Code extension for IDE integration

The architecture is designed for scalability and ecosystem expansion.

---

## 🏗️ Architecture Diagram

<p align="center">
  <img src="https://raw.githubusercontent.com/ArnavMurdande/CodeWithMee/aef405d65c3066990cd20d46d9fd2572b85e6606/CodeWithMe%20Architecture%20diagram.png" width="900"/>
</p>

---

## ✅ Completed Features

### 1. Interactive Split-Screen Sandbox
Live coding + tutorial viewing with real-time execution.

### 2. Persistent AI Assistant
Gemini-powered mentor integrated into coding workflow.

### 3. Secure Authentication System
JWT login + encrypted user credentials.

### 4. Database Infrastructure
Collections implemented:

- Users
- Challenges
- Submissions
- YouTube Cache

Foundation for gamification & analytics.

### 5. Code Execution Backend
Server-side Python execution engine:

- secure sandboxed execution
- console output capture
- frontend integration

### 6. Modern UI System
Animated and immersive developer-style interface.

---

## 🚧 Future Scope

### AI Debugger (Auto-Fix Engine)
One-click debugging:

- captures runtime errors
- sends code to AI
- returns corrected version
- diff viewer for learning

### Gamified Social System
- streak tracking
- activity reinforcement
- leaderboards
- course competition

### Advanced Sandbox v2
- video resume memory
- resizable panes
- IDE-like workspace

### Study Buddy System
Peer matching for collaborative learning.

### Project Builder Ecosystem
4-layer system:

1. Idea board
2. AI scaffolding generator
3. contribution approval system
4. progress feed

### VS Code Extension
Local IDE integration with AI assistant.

### Company Training Portal
Enterprise dashboard for internal learning systems.

---

## 🧠 Technical Themes

- AI-assisted education
- sandboxed code execution
- collaborative development systems
- gamification psychology
- scalable MERN architecture
- IDE ecosystem integration
- community-driven learning

---

## 💻 Tech Stack

| Category | Technology |
|---------|------------|
| Frontend | React, JavaScript, CSS3, Monaco Editor |
| Backend | Node.js, Express |
| Database | PostgreSQL 16+/Prisma 7 target baseline; MongoDB compatibility source pending Phase 0C cutover |
| AI | Google Gemini API |
| Authentication | Argon2id, short JWT access tokens, rotating refresh sessions, Google OIDC |
| Execution Engine | Python sandbox execution |
| APIs | YouTube Data API |

---

## 🛠️ Setup & Installation

### Prerequisites

- Node.js `24.18.0` and npm `11.x` (the repository rejects unsupported majors)
- Git
- MongoDB only for currently compatible database-backed routes
- PostgreSQL 16+ only when exercising the Phase 0C migration/database gates
- A Piston-compatible runner only for code execution
- Gemini/YouTube keys only when those provider features are exercised

### 1. Install exact dependency trees

From the repository root:

```bash
npm run install:all
```

This runs `npm ci` against the independent root, client and server lockfiles. Do not use `npm audit fix --force`.

### 2. Configure public and server environments

Copy `client/.env.example` to `client/.env` and `server/.env.example` to `server/.env`, then replace development placeholders locally. Browser `VITE_` values are public; never place secrets in them. Never commit either `.env` file.

The API can construct and serve `/api/test` without MongoDB. Database-backed routes remain unavailable until `MONGO_URI` is valid. AI, YouTube and Piston integrations fail closed or unavailable when their settings are absent.

The checksum-pinned PostgreSQL target is in `prisma/`. Core identity, organization and authority PostgreSQL repositories exist behind default-Mongoose cutover controls; direct feature routes remain Mongoose-only. Schema-only commands need no database secret:

```bash
npm run db:format
npm run db:validate
npm run db:generate
```

`npm run db:migrate:deploy`, `npm run db:seed` and `npm run test:database:integration` mutate a database and are guarded. For a disposable local target, use a loopback PostgreSQL URL whose database ends in `_ci`, `_test` or `_dev`, and set `DATABASE_SAFETY_SCOPE=disposable`. Staging/production additionally require a non-superuser account and exact `DATABASE_DEPLOY_APPROVAL=<environment>:<database>`. Never point these commands at an unreviewed database. The seed creates only role/permission definitions and never a superadmin.

The unified `/api/v1` identity API requires an explicit `ACCESS_TOKEN_SECRET` and a different `REFRESH_TOKEN_PEPPER`, each at least 32 random bytes. `JWT_SECRET` and the former `x-auth-token` recovery bridge are retired in every environment. Production additionally requires HTTPS `WEB_APP_ORIGIN` and secure cookies. Identity routes remain `503` when required secrets or their selected database are unavailable rather than falling back to weak or legacy credentials.

Google login uses an authorization-code flow with state, nonce and PKCE. Configure all four Google/OAuth variables in `server/.env.example` or none. Live email is not configured yet: the development adapter records only an unavailable delivery event and never logs verification/reset tokens; injectable capture delivery is used in tests.

Password creation/reset uses a local weak-password denylist in development. Production defaults to required Pwned Passwords k-anonymous range screening: only the first five SHA-1 hash characters are sent, padded responses are requested, and the plaintext/full hash never leaves the API. `best_effort` is available only as an explicitly accepted availability tradeoff.

The first superadmin is never seeded or exposed through HTTP. Set the three temporary `SUPERADMIN_BOOTSTRAP_*` values documented in `server/.env.example`, run `npm run bootstrap:superadmin` once, retain the audit-event ID, then remove those values. The command follows the verified selected core repository: compatibility Mongo requires transactions, while a PostgreSQL cutover additionally requires matching deployment/database activation records.

### 3. Run locally

Use two terminals from the repository root:

```bash
npm run dev:server
```

```bash
npm run dev:client
```

By default, the client is at `http://127.0.0.1:3000` and proxies `/api` and `/uploads` to `http://127.0.0.1:5001`. The server binds to `HOST`/`PORT`; its default host is `0.0.0.0` for parity with the previous entry point.

### 4. Verify before changing phases

```bash
npm run check:tooling
npm run lint
npm run typecheck
npm run build
npm run test:server
npm run db:validate
```

The broad `npm test` intentionally remains non-zero until Phase 0F installs a Vite-compatible browser/component test runner.

### Read-only data migration rehearsal

Phase 0C migration tooling is operator-only and does not use the application Mongo connection implicitly. Configure the dedicated migration variables documented in `server/.env.example`, then use an exclusive ignored output directory:

```bash
npm run migration:inventory -- --source auto --uploads server/uploads --output migration-output/inventory-run
npm run migration:export -- --source mongo --output .migration-private/source-snapshot
npm run migration:dry-run -- --snapshot .migration-private/source-snapshot --output migration-output/dry-run
```

`--source auto` reports the source as unavailable when `MIGRATION_SOURCE_MONGO_URI` is absent. Export data is independently authenticated/encrypted, reports redact raw identifiers and paths, and the source CLI always refuses writes. Never commit keys or generated artifacts.

After reviewing the dry-run, P0C-S4 provides a separately guarded target writer:

```bash
npm run migration:import -- --snapshot .migration-private/source-snapshot --apply
```

This command requires the database safety settings, `MIGRATION_IMPORT_MODE=write` and `MIGRATION_IMPORT_APPROVAL=import:<database>:<full-dataset-sha256>`; staging/production additionally require a confirmed write freeze. It accepts only the authenticated snapshot, fingerprints source IDs, invalidates transient security state and quarantines ambiguous records. A successful import does not switch runtime traffic.

Generate the independently authenticated, read-only parity artifact with:

```bash
npm run migration:parity -- --dataset-sha256 <sha256> --output <new-private-report.json>
```

The guarded activation/rollback commands are `npm run persistence:cutover -- activate ...` and `... rollback ...`; do not run them from ordinary application/CI processes. Identity, organizations and authority move together, legacy APIs must be disabled during their PostgreSQL cutover, and every direct feature domain remains ineligible until its owning phase adds a service repository. Follow `docs/runbooks/PERSISTENCE_CUTOVER.md`; all stores default to Mongoose and no live cutover has been performed.

### Backup, restore, and reconciliation

`npm run db:backup -- <new-file.cwmbackup>` creates a bounded AES-256-GCM application-data archive from an exact approved read-only PostgreSQL target. `npm run db:restore -- <file.cwmbackup> --apply` accepts it only into a different, migrated, otherwise-empty approved database and compares all 62 application tables before commit. This verifier complements—never replaces—managed PITR, native `pg_dump`/`pg_restore`, and private object-version backups.

`npm run files:reconcile -- <new-report.reconciliation.json>` is read-only: it compares PostgreSQL file records, the configured private object prefix, and an optional retained local-upload inventory, emitting only HMAC references. It never deletes an object. Follow `docs/runbooks/BACKUP_RESTORE_AND_LEGACY_RETIREMENT.md`; Mongoose and local uploads remain retained until every domain, parity, restore, reconciliation, rollback-retention, and legal-hold gate passes under a separately reviewed removal change.

### Private file development boundary

New uploads use `/api/v1/files` and remain unavailable unless PostgreSQL plus the complete `FILE_STORAGE_*` configuration are present. Production additionally requires an external scanner and rejects local `/uploads` serving. The server issues short private S3-compatible PUT/GET URLs; a completed upload remains unreadable until provider metadata/checksum verification and a clean scan result.

For local compatibility only, `LOCAL_UPLOAD_SERVING=true` retains the existing disk files. Do not use it for private, assignment or payment content. Direct video and ZIP uploads are deliberately rejected until isolated scanning/archive validation and paid delivery capacity exist. The cleanup command requires the exact bucket-scoped approval documented in `server/.env.example`.

### Troubleshooting

- Runtime rejection: confirm `node --version` is `v24.x` and `npm --version` is `11.x`.
- Client cannot reach the API: start the server, then check `VITE_DEV_API_PROXY_TARGET`; do not reintroduce literal localhost URLs in source.
- Mongo unavailable: confirm `MONGO_URI`; startup continues in development but logs that database routes are unavailable.
- Prisma engine cache denied on Windows: the schema is local, but Prisma may need access to its existing `%APPDATA%\Prisma` engine cache after a clean install. Do not work around this by changing the database target or weakening the mutation guard.
- PostgreSQL mutation rejected: confirm the loopback/test database name and `DATABASE_SAFETY_SCOPE`; for staging/production, use a least-privilege migrator and the exact approval value. Do not call Prisma migration commands directly to bypass the guard.
- PostgreSQL persistence cutover rejected: verify the signed report says every selected domain is ready, the core domains are selected together, the source-retention deadline is still future, writes are frozen, and deployment settings exactly match the database feature-flag generation. Do not edit flags manually or enable dual writes.
- Portable backup/restore rejected: verify the exact source/schema or target/archive approval, canonical 32-byte key, distinct empty restore database, applied migration set and non-symlink archive path. Never clear a target or bypass its non-empty check to force a restore.
- File reconciliation blocked: resolve or quarantine every keyed report issue through a separate reviewed workflow; do not delete objects or infer legacy owners merely to make the report green.
- Unified identity unavailable: configure both strong identity secrets and MongoDB. A partial/short secret set intentionally disables the development module and is fatal in production.
- Verification/reset email unavailable: this is the expected local fallback until a transactional email adapter is activated; token values are never written to logs.
- Google login unavailable: configure client ID, client secret, exact callback URL, and a separate 32-byte OAuth transaction secret together; register the exact callback with Google.
- Password screening unavailable: production intentionally returns a temporary unavailable error when its required range check cannot complete; restore provider access or explicitly record a `best_effort` risk decision rather than logging/bypassing passwords.
- Port collision: change `PORT` for the server or pass a Vite port argument to the client command.
- Invalid CORS configuration: use comma-separated origins only, such as `http://127.0.0.1:3000`, with no URL paths.
- Code execution unavailable: set `PISTON_API_URL` to an HTTP(S) execution endpoint; never execute submissions inside the API process.
- File API unavailable: either leave it disabled intentionally or configure PostgreSQL, `FILE_STORAGE_MODE=s3`, a valid private bucket/region, and the provider credentials/workload identity. Production also needs `FILE_SCANNER_MODE=external` and HTTPS for custom endpoints; do not expose local uploads as a workaround.
- Dependency install blocked by the network: rerun the same deterministic `npm run install:all` after registry access is restored; do not delete source or force peer resolution.

---

## 🎯 Vision

CodeWithMee aims to become:

> An AI-powered learning operating system that merges education, collaboration, and real-world development into one unified ecosystem.

Users don’t just learn — they build, collaborate, and grow inside a guided AI environment.

---

## 👨‍💻 Authors

Developed as an academic and experimental AI learning platform project by Arnav Murdande & Tanishk Ojha

---

## ⭐ Support

If you like the project, consider starring the repository!

