# AGENTS.md

> **Read this file in full before writing any code in this repository.**
> It applies to every AI coding agent — Claude Code, Cursor, Copilot, Aider, OpenCode, or any other.
> This file lives at the repository root on purpose — see [§M](#m-instruction-discovery).

## Quick start

```bash
# 1. The rules you are bound by (this file)
cat AGENTS.md

# 2. Understand the system
cat docs/README.md          # documentation index and reading order
cat docs/ARCHITECTURE.md    # where the code lives
cat docs/CODE_STYLE.md      # how to match the existing style

# 3. Before you finish
cat docs/TESTING.md         # commands you must actually run
```

---

## A. Project Context

### What Live Location Tracker is

Live Location Tracker is a browser-based, real-time location-sharing app.
Signed-in users put their live GPS position on a Leaflet map, see accepted
friends, issue time-limited share links for guests, and create enter/exit
geofence alerts. It is built for small groups coordinating a trip or meetup;
the same codebase is also a working reference for Socket.IO + Kafka + batched
MongoDB writes.

### Repository layout

```text
Live Location Tracker/
├── AGENTS.md                     These rules
├── README.md                     Public project README
├── DEPLOYMENT.md                 Original root deployment runbook
├── .env.production.example       Production variable template (placeholders only)
├── docker-compose.yml            Local Kafka + MongoDB
├── docker-compose.prod.yml       Backend-only production compose (`name: llt`)
├── backend/
│   ├── Dockerfile                node:22-alpine, non-root, backend-only image
│   ├── package.json              CommonJS, start/dev scripts (no tests)
│   ├── .env.example              Local backend variable template
│   └── src/
│       ├── server.js             Express + session + Socket.IO + bootstrap
│       ├── config/               db.js, kafka.js, passport.js
│       ├── middleware/auth.js    getRequestUser, requireAuth
│       ├── models/               User, Friend, Geofence, ShareSession, LocationHistory
│       ├── routes/               auth, share, friends, geofences
│       ├── consumers/            broadcastConsumer.js, dbConsumer.js
│       └── socket/handler.js     Auth, active users, location events, geofences
├── frontend/
│   ├── index.html                Single page: login + map + all panels
│   ├── css/style.css             All styles and design tokens
│   ├── js/                       app.js + auth, socket, map, search, directions,
│   │                             tools, sharing, geofencing
│   ├── public/                   manifest.json, sw.js
│   └── vercel.json               Rewrites + no-store headers
├── deploy/
│   └── nginx/llt.conf            Tracked copy of the shared-nginx vhost
├── scripts/
│   ├── deploy.sh                 Build/recreate backend, poll health
│   ├── install-nginx-vhost.sh    Check or apply the tracked nginx vhost
│   └── server-setup.sh           One-time server bootstrap
├── .github/workflows/deploy.yml  Push-triggered rsync + SSH deploy
└── docs/                         This documentation system
```

Generated/ignored, not part of the source tree: `backend/node_modules/`,
`frontend/node_modules/`, `frontend/dist/`, `.env` files, `backend/scratch/`.

### Stack

| | |
|---|---|
| Backend | Node.js 22 (`node:22-alpine`), Express 4.22.2, Socket.IO 4.8.3, KafkaJS 2.2.4, Passport 0.7.0, `jsonwebtoken` 9.0.3 |
| Frontend | Vanilla JavaScript ES modules, Vite 5.4.21, Leaflet 1.9.4 (CDN), Inter, hand-written CSS |
| Data | MongoDB 7 via Mongoose 8.23.1; Kafka 3.9.1 (`global-kafka`), topic `location-updates`, 1 partition |
| Runtime | Oracle Cloud ARM64 + Docker (`llt-backend`, 1 GiB limit, no host port), shared `global-nginx`, Vercel static frontend |

Versions are the installed versions read from `npm ls` and the live containers
on 2026-10-20, not the semver ranges.

### Non-negotiable constraints

| # | Constraint |
|---|---|
| 1 | **The backend is one Node process.** Do not add PM2 cluster mode, replicas, or a second container without a Socket.IO Redis adapter, sticky sessions, and a shared rate limiter. `activeUsers`, `rateLimitMap`, and the consumer dedup cache are in memory. |
| 2 | **Kafka is on the location write path only.** Topic `location-updates` has **1 partition**; events are keyed by `userId`. Changing partitions or adding consumer groups requires an ordering/fan-out review. |
| 3 | **The backend image is backend-only.** The frontend is deployed from Vercel. Do not copy `frontend/` into the image or make the backend serve it in production. |
| 4 | **HTTP is same-origin via Vercel rewrites.** `/auth/*` and `/api/*` proxy to the backend; **Socket.IO connects directly** because Vercel cannot carry the WebSocket upgrade. Do not “fix” this by making browser HTTP calls to the raw backend host. |
| 5 | **Shared infrastructure is out of scope.** `global-nginx`, `global-mongodb`, `global-kafka`, and `platform-network` are managed by the Infra repo. Never restart, recreate, prune, or delete them as part of an LLT change. |
| 6 | **Production secrets live only in the server `.env` (mode 600), Vercel env, and GitHub secrets.** Never commit, print, copy into docs, or bake them into an image. |
| 7 | **`LocationHistory` is ephemeral.** A TTL index deletes points 24 hours after `timestamp`. Do not build a durable history/trip-replay feature on it without a schema decision. |
| 8 | **No migration framework and no test runner/linter.** Do not invent either for a single change. Schema changes follow [docs/DATABASE.md](docs/DATABASE.md) §8; verification follows [docs/TESTING.md](docs/TESTING.md). |
| 9 | **Do not change existing API/event contracts casually.** The frontend and the guest share viewer consume the current response shapes, status codes, enum values, and socket event names. Check both sides before changing one. |
| 10 | **The frontend is vanilla ES modules.** Do not introduce React/Vue, TypeScript, a state library, or a new build step as part of an unrelated change. |

---

## B. Reading the Documentation

### B1. Consult the documentation first

Before implementing any **non-trivial** change, read:

| Your change | Read first |
|---|---|
| Any behaviour change | [PRD.md](docs/PRD.md) + [UX_FLOWS.md](docs/UX_FLOWS.md) |
| New or changed endpoint | [API.md](docs/API.md) |
| New or changed model/field/index | [DATABASE.md](docs/DATABASE.md) |
| New or changed UI | [DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) |
| Anything touching auth or secrets | [SECURITY.md](docs/SECURITY.md) |
| Any code | [CODE_STYLE.md](docs/CODE_STYLE.md) |
| Anything needing verification | [TESTING.md](docs/TESTING.md) |
| Deployment or env changes | [DEPLOYMENT.md](docs/DEPLOYMENT.md) + [ENVIRONMENT.md](docs/ENVIRONMENT.md) |
| Third-party calls | [INTEGRATIONS.md](docs/INTEGRATIONS.md) |
| Query shape or resource usage | [PERFORMANCE.md](docs/PERFORMANCE.md) |

### B2. Resolving documentation/code conflicts

**The code is always authoritative.** A document that disagrees with the
implementation is stale.

1. Verify by reading the actual handler, schema, or config.
2. Implement against the **code**.
3. Record the conflict in [README.md §6](docs/README.md#6-known-inconsistencies-between-docs-and-code).
4. Fix the document in the same change.
5. **Never** change application code to make a document appear correct.

If you are **unsure** whether the code or the document is right, stop and ask.

### B3. Never invent

Never fabricate: features · business rules · endpoints · models · fields ·
roles · permissions · env vars · integrations · deployment steps · test
results · roadmap items · **user numbers, metrics, or testimonials**.

If you cannot verify something, mark it **UNKNOWN** and report it.

> An empty `TODO` is honest. Invented content is a defect. The difference
> between a scaffold and a liability is whether anyone filled these in.

### B4. Maintain status markers

Use **VERIFIED / INFERRED / UNKNOWN / PROPOSED**. Do not present INFERRED or
PROPOSED as existing behaviour.

---

## C. Codebase Inspection

### C1. Read before you write

Before modifying any file, you must have actually read:

| Change | Files to read |
|---|---|
| A route | the router + the middleware it uses + the models it touches |
| A model | the model + every route that queries it |
| A page | the page **and** the components it renders |
| An endpoint consumed by a page | Both — the call site **and** the handler |
| A permission or plan rule | wherever the rule is defined **and** wherever it is duplicated |

**Naming is not evidence.** A file called `sendEmail.js` may not send email. Open it.

### C2. Search for existing implementations first

```bash
# Does a helper already do this?
grep -rn "function <name>\|const <name> =" <utils-dir>

# Is this endpoint already implemented?
grep -rn "'/<path>'" <routes-dir>

# Is this component already used?
grep -rn "<ComponentName" <frontend-dir>
```

**Never create a duplicate implementation.**

### C3. Check the consumers

A schema or contract change affects more than one file. Before changing:

- a model → grep for every query of it
- an endpoint → grep the frontend for calls to it
- a realtime event → grep **both** the server handler and the client
- a constant → grep for every duplicate copy of it

---

## D. Implementation Rules

### D1. Reuse before building

| Need | Use |
|---|---|
| HTTP API base and auth headers | `AuthManager.getApiBase()` / `AuthManager.getAuthHeaders()` in `frontend/js/auth.js` |
| Socket connection, location send, share viewer | `SocketManager` in `frontend/js/socket.js` |
| Map, markers, tile layers | `MapManager` in `frontend/js/map.js` |
| Forward/reverse geocoding, POIs, recent searches | `SearchManager` in `frontend/js/search.js` |
| Routes, profiles, auto-reroute, route search | `DirectionsManager` in `frontend/js/directions.js` |
| Measure distance/area, drop pin, fullscreen | `ToolsManager` in `frontend/js/tools.js` |
| Share links, QR, friends, guest viewer | `SharingManager` in `frontend/js/sharing.js` |
| Geofence create/list/delete | `GeofencingManager` in `frontend/js/geofencing.js` |
| Toast notifications | The `showToast` callback passed into managers from `app.js` |
| Backend auth (session or JWT) | `getRequestUser` / `requireAuth` in `backend/src/middleware/auth.js` |
| Mongo connection | `connectDB` in `backend/src/config/db.js` |
| Kafka producer, consumer factory, topic | `producer`, `createConsumer`, `TOPIC`, `initKafka` in `backend/src/config/kafka.js` |
| Location input validation | `validateLocationData` in `backend/src/socket/handler.js` (private; export only for a test) |
| Geofence distance | `haversineMeters` in `backend/src/socket/handler.js` (private; export only for a test) |
| Share-session JSON shape | `serialize` in `backend/src/routes/share.js` (private) |
| nginx reverse-proxy vhost | `deploy/nginx/llt.conf` (tracked copy) + `scripts/install-nginx-vhost.sh` (check/apply) |
| HTML escaping in share/friend/geofence rows | The local `escapeHtml` in `sharing.js` / `geofencing.js` (duplicated; do not add a third copy) |
| Session middleware | `sessionMiddleware` in `backend/src/server.js` (local; shared with Socket.IO) |

### D2. Respect architectural boundaries

| Rule | Detail |
|---|---|
| Bootstrap vs feature logic | `server.js` does env validation, Express/session/Socket.IO wiring, route mounting, `/health`, static serving, Kafka startup, and graceful shutdown. Feature logic belongs in `routes/*`, `socket/handler.js`, or `consumers/*`. |
| HTTP layer | Routes parse/validate input, apply `requireAuth`, scope queries to `req.authUser._id`, choose status codes, and return the documented shape. They call models directly. |
| Persistence | Models own schema, indexes, and instance methods (`ShareSession.isAvailable`). Do not put route-specific branching in a model. |
| Realtime ingress | `socket/handler.js` is the **only** Kafka producer path. It owns location validation, the per-user rate limit, active-user state, and geofence evaluation. |
| Realtime egress | `broadcastConsumer` is the only Socket.IO fan-out from Kafka; `dbConsumer` is the only batched history writer. Do not add a second producer or consumer group without an architecture review. |
| No abstraction layer | There is no service, controller, repository, DTO, or dependency-injection layer. Do not add one for a single endpoint. |
| Frontend orchestration | `app.js` wires auth, socket, geolocation, managers, toasts, and mobile navigation. Managers own their feature's DOM and state. |
| Frontend API access | Use `AuthManager.getApiBase()` and `getAuthHeaders()`; do not hardcode the backend URL or read `localStorage` directly in a new module. |
| Frontend manager imports | `sharing.js` and `geofencing.js` may import `auth.js`, `socket.js`, and `map.js`. Do not import `app.js` from a manager, and do not create a circular import. |
| Shared client state | `MapManager` owns markers, `SocketManager` owns the socket, `AuthManager` owns the token. Do not add a global store or a second source of truth. |

### D3. Preserve existing functionality

- Do **not** change behaviour unless explicitly requested.
- Do **not** "clean up" adjacent code.
- Do **not** normalise response shapes, error messages, or enum values that other code depends on.
- Do **not** remove an endpoint, even a deprecated one, without explicit instruction.
- If a change requires a behaviour change elsewhere, say so **before** making it.

### D4. Keep changes focused

- Solve the stated problem. Nothing more.
- No unrelated formatting, no opportunistic renames, no drive-by refactors.
- No dependency upgrades unless explicitly requested.
- No framework replacements.

### D5. Avoid unnecessary abstractions

- Match the existing level of abstraction. Do not introduce a state library,
  a validation library, or a service layer that this project does not use.
- Do not introduce a monorepo shared package without a decision.

### D6. Avoid unnecessary dependencies

Before adding one, verify nothing already installed covers the need. Adding a
dependency requires explicit authorisation.

### D7. Never duplicate

If a helper, constant, or permission already exists, reuse it. If you find a
duplicate copy, report it — do not add a third.

---

## E. Database Rules

### E1. Schema changes

Schema changes must be:

1. **Reviewed** — state the change and its impact before implementing
2. **Documented** — [DATABASE.md](docs/DATABASE.md) updated in the same change
3. **Migrated** using the project's real process

The actual process is manual:

1. State the field/index/TTL change and its impact before editing the model.
2. Check existing data for conflicts (duplicates before a unique index, missing values before a required field).
3. Edit the Mongoose model and update [DATABASE.md](docs/DATABASE.md) §8 in the same change.
4. Test against a copy or a disposable database. There is no staging database in this repository.
5. Deploy. Mongoose `autoIndex` builds new indexes at model init; watch the logs for `E11000`.
6. Verify with `db.<collection>.getIndexes()` and a real query.
7. Backfill in a separate, resumable script if needed.

**There is no migration framework.** Do not invent one for a single change.

### E2. Destructive operations — require explicit authorisation

**Never run, and never write a command that runs, any of these without
explicit human authorisation:**

**Application endpoints (data loss or consent change):**

- `DELETE /api/friends/:id` — hard-deletes both directional `Friend` rows
  (`backend/src/routes/friends.js`)
- `DELETE /api/geofences/:id` — hard-deletes the owner's geofence
  (`backend/src/routes/geofences.js`)
- `POST /api/share/:code/stop` — sets `isActive:false`; consent-ending, not a
  data wipe (`backend/src/routes/share.js`)

**Database commands (never against production without authorisation):**

- `db.dropDatabase()`
- `db.<collection>.deleteMany({})`
- `db.<collection>.dropIndex(...)` (including a TTL index)
- Any `updateMany` that rewrites or removes fields at scale

**Docker / infrastructure commands (shared host):**

- `docker compose ... down -v`
- `docker volume prune`, `docker system prune`, `docker image prune -a`
- `docker rm -f global-nginx global-mongodb global-kafka`
- Deleting or recreating `platform-network`
- `scripts/deploy.sh` — rebuilds and **force-recreates** `llt-backend`
  (brief app downtime); it prunes dangling images only
- `CONFIRM=yes scripts/install-nginx-vhost.sh --apply` — writes the shared
  nginx vhost and reloads `global-nginx`; affects every app behind it
- `scripts/server-setup.sh` — creates the shared network, a Mongo user, and
  `.env`; privileged, though idempotent

**Git commands (discard user work):**

- `git reset --hard`, `git clean -fd`, `git checkout .`, `git restore .`

**Filesystem:**

- `rm -rf /opt/apps/live-location-tracker`
- Any `rsync --delete` outside the backend path already used by
  `.github/workflows/deploy.yml`

**Never execute destructive commands against production.** No exceptions.

### E3. Preserve data and compatibility

- **There are no transactions.** MongoDB multi-document writes are not atomic. Accepting a friend performs two writes (`accept` + reciprocal upsert); a crash between them leaves one side pending. The DB consumer writes `LocationHistory` and `User.lastSeen` in one `try` block without a transaction; a failure after `insertMany` can lose the `lastSeen` update for that batch.
- **Adding a `unique` index to a collection with existing duplicates breaks model init.** Unique indexes exist on `User.googleId`, `Friend.{userId,friendId}`, `ShareSession.shareCode`, and `LocationHistory.eventId`. Deduplicate before adding/rebuilding.
- **`LocationHistory` is ephemeral.** The `{ timestamp: 1 }` TTL deletes points after 86400 seconds; the monitor is not instant. Do not build durable history or trip replay on it.
- **Changing a TTL option does not alter an existing index.** Use `collMod` or drop/recreate the index; Mongoose `autoIndex` does not rewrite index options.
- **Removing a field from a schema does not remove it from existing documents.** Old fields remain visible to `.lean()` and populated documents.
- **Narrowing a field type requires a backfill.** Mongoose casts on read/write, but existing documents are not migrated automatically.
- **`Friend` is directional.** Accepted pairs normally have two rows. Any query that assumes one row per pair is wrong.
- **`ShareSession.allowedViewers` is stored but not enforced.** Do not treat it as an authorization control.
- **`User.email` is not unique.** Friend lookup is `findOne` by an escaped anchored regex on `User.email`; duplicate emails resolve arbitrarily.
- **Geofence `lastState` is last-write-wins.** It is read/compared/saved per event without an atomic compare-and-set, so concurrent events can duplicate or miss a transition.
- **No referential integrity or cascade.** There are no foreign keys and no account-deletion endpoint; deleting a user would orphan friends, fences, shares, and history.

---

## F. API Rules

### F1. Preserve existing contracts

Unless a change is explicitly requested:

- Do not change existing paths, methods, status codes, or response shapes
- Do not change error messages other code may match on
- Do not change enum values
- Do not change emitted event names or payload shapes

### F2. Breaking changes

If a breaking change is genuinely required:

1. **Ask first.** Do not proceed unilaterally.
2. List every consumer — grep the frontend for the endpoint or event
3. Document the old and new contract
4. Run the applicable checks in [TESTING.md](docs/TESTING.md); there is no test suite
5. Update [API.md](docs/API.md)

### F3. New endpoints must

- Apply the auth middleware unless deliberately public
- Enforce authorization **server-side** — UI gating is not a control
- Scope every query to the caller's permissions
- Use `try/catch` with the project's error convention
- Validate input — **allow-list accepted keys, never spread `req.body`**
- Document in [API.md](docs/API.md) with method, path, auth, validation, responses, side effects

---

## G. Security Rules

**Absolute rules. Violating any of these fails the task.**

| # | Rule |
|---|---|
| G1 | **Never expose secrets, tokens, keys, or codes** in code, logs, responses, errors, comments, or documentation. |
| G2 | **Never bypass, weaken, or remove** an auth, ownership, permission, or validation check. |
| G3 | **Never introduce an insecure default.** |
| G4 | **Never read values from `.env` into documentation, logs, or responses.** |
| G5 | **Never hardcode a credential.** |
| G6 | **Never commit `.env` or any secret-bearing file.** |
| G7 | **Never log** passwords, tokens, OTPs, reset codes, or API keys. |
| G8 | **Never return internal error detail in production.** |
| G9 | **Never mass-assign from `req.body`.** Allow-list accepted keys. |
| G10 | **Never change** proxy trust settings, middleware ordering, or sanitisation. |

### Known gaps — do not "fix" incidentally

These are recorded in [SECURITY.md §9](docs/SECURITY.md#9-verified-security-gaps).
If you touch one, **report it**, but do not silently redesign it. Fixes require
human authorisation.

| # | Gap | Severity |
|---|---|---|
| 1 | Stored XSS via an unescaped `displayName` in `app.js` / `map.js`; the JWT is in `localStorage` | **High** |
| 2 | `npm audit`: backend has 1 critical (`proxy-addr`) + 3 high + 6 moderate; frontend toolchain has 4 high + 1 moderate | **High** |
| 3 | JWT appears in the OAuth redirect query and is stored in `localStorage` | **Medium** |
| 4 | No JWT revocation; logout leaves a valid token for up to 24 h | **Medium** |
| 5 | OAuth `state` is not enabled/verified | **Medium** |
| 6 | `allowedViewers` is stored but never enforced | **Medium** (latent) |
| 7 | No HTTP rate limiting (auth, share lookup, friend lookup) | **Medium** |
| 8 | No CSP/`helmet`; `X-Powered-By: Express`; no SRI on CDN scripts | **Low** |
| 9 | No custom error handler; default Express errors may leak stack detail outside production | **Low** |
| 10 | Friend lookup reveals whether an email is registered; invalid ObjectIds on DELETE can 500 | **Low** |
| 11 | Startup env guard accepts `CHANGE_ME` placeholders; no account deletion/export | **Low** |
| 12 | Map attribution is hidden by CSS, contrary to OSM/Esri/OpenTopoMap terms | **Low** (compliance) |
| 13 | Service worker caches same-origin API GETs cache-first; the cache key ignores `Authorization` and is not cleared on logout | **High** (privacy/auth state) |

### If you find a new vulnerability

Document it in [SECURITY.md §9](docs/SECURITY.md#9-verified-security-gaps).
**Do not fix application code as part of a documentation or unrelated task.**

---

## H. Testing Rules

### H1. Run what the project supports

There is **no test runner, linter, or type checker** in this repository. Do not
invent one for an unrelated change. These are the commands that exist:

| Command | Run when |
|---|---|
| `cd backend && npm run dev` | Local backend with `node --watch`; requires a complete `backend/.env` |
| `cd backend && npm start` | Production-style backend start; requires env |
| `cd frontend && npm run dev` | Vite dev server (`:5173`); backend must run on `:3000`, and `CLIENT_URL` must allow the Vite origin |
| `cd frontend && npm run build` | Static frontend build; locally this currently fails on a missing Rollup native optional dependency (see [TESTING.md](docs/TESTING.md) §2). Vercel builds it successfully. |
| `find backend/src -name '*.js' -print0 \| xargs -0 -n1 node --check` | Backend syntax check |
| `bash -n scripts/deploy.sh && bash -n scripts/install-nginx-vhost.sh && bash -n scripts/server-setup.sh` | Shell syntax check |
| `cd backend && npm audit --omit=dev` | Dependency advisory check |
| `cd frontend && npm audit` | Dependency advisory check |
| `curl` the live health/auth/share/socket URLs | Manual deployment smoke check |

### H2. Never claim a check passed unless it ran

**You must have executed the command in this session and seen the output.**
Never write "tests pass", "typecheck is clean", or "the build succeeds" on the
basis of expectation.

If a command was not run, say so plainly.

> **This is not optional.** A test that passes locally but depends on a local
> `.env` will fail in CI, and nobody will have told you.

### H3. Do not install dependencies to test

Do not add a test framework or any other dependency without authorisation.

### H4. Add tests for pure helpers

A new pure function should have a test. If the module under test is hard to
import, export the helper purely for testability.

### H5. Tests must not depend on ambient environment

A test that passes only because your local `.env` defines a variable will fail
in CI, which has no `.env`. Any test that needs configuration must set it
itself and restore it afterwards.

---

## I. Writing the Documentation

### I1. Update documentation in the same change

| You changed | Update |
|---|---|
| An endpoint | [API.md](docs/API.md) |
| A model, field, index, enum, or TTL | [DATABASE.md](docs/DATABASE.md) |
| An env var | [ENVIRONMENT.md](docs/ENVIRONMENT.md) **and both `.env.example` files** |
| A design token or component | [DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) |
| A user journey | [UX_FLOWS.md](docs/UX_FLOWS.md) |
| Deploy or CI behaviour | [DEPLOYMENT.md](docs/DEPLOYMENT.md) |
| A security control or gap | [SECURITY.md](docs/SECURITY.md) |
| Product behaviour | [PRD.md](docs/PRD.md) |
| Architecture | [ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| A notable change | [CHANGELOG.md](docs/CHANGELOG.md) |

### I2. Preserve useful existing documentation

- Keep existing content that is still accurate
- Update rather than overwrite
- Do not delete a document to "start clean"

### I3. Do not create documents for the sake of it

Extend an existing document instead. Only create a new one when a subsystem
genuinely warrants it.

### I4. Search for secrets before committing

```bash
grep -rn "mongodb+srv://\|mongodb://[^ ]*:[^ ]*@\|AKIA\|sk_live\|AIza\|-----BEGIN\|password.*=.*['\"][^'\"]{8,}"
```

Any hit in a **new** file is a failure.

---

## J. Change Management

### J1. Review before finishing

- `git status` — what changed?
- `git diff` — read the actual diff, not the summary
- Confirm **no application code changed** unless intended
- Confirm no `node_modules/`, `.env`, or build artifacts are staged

### J2. Preserve user work

- **Never** discard uncommitted changes with `git checkout .`, `git restore .`, `git reset --hard`, or `git clean`.
- **Never** revert a change you did not make.
- **Never** run destructive git commands without explicit authorisation.

### J3. Keep a change focused

One logical change per task. Do not bundle unrelated fixes — report them instead.

---

## K. Completion Criteria

A task is complete only when **all** of the following hold:

| # | Criterion |
|---|---|
| K1 | The requested requirements are **actually** addressed. |
| K2 | Existing behaviour is preserved unless a change was explicitly requested. |
| K3 | Applicable validation was **actually executed**, and the results reported honestly. |
| K4 | Security constraints are respected — no new gap, no weakened control. |
| K5 | Relevant documentation was **updated in the same change**. |
| K6 | Unintended changes were checked via `git diff` and reverted if accidental. |
| K7 | Unresolved limitations and unverified claims were **reported**. |

### Required final report

When you finish, report:

1. **Files created**
2. **Files updated**
3. **What you verified and how** (commands actually run + their outcome)
4. **What you did not verify** and why
5. **Any documentation conflicts** you found
6. **Any new security or correctness concerns** you noticed but did not fix
7. **Explicit confirmation** that application code was not modified unintentionally

**Do not overstate completeness.** Saying "I could not verify X" is correct.
Saying "everything works" without running anything is not.

---

## L. Quick Reference

| I need to… | Go to |
|---|---|
| Add an endpoint | [API.md](docs/API.md) |
| Add a field | [DATABASE.md](docs/DATABASE.md) |
| Add a UI component | [DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) |
| Change auth | [SECURITY.md](docs/SECURITY.md) — **ask first** |
| Add an env var | [ENVIRONMENT.md](docs/ENVIRONMENT.md) + both `.env.example` files |
| Deploy | [DEPLOYMENT.md](docs/DEPLOYMENT.md) |
| Debug something | [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) |
| Why is it slow? | [PERFORMANCE.md](docs/PERFORMANCE.md) |

---

## M. Instruction Discovery

- **`AGENTS.md` at the repository root is the canonical ruleset** — the single
  source of truth for agent behaviour.
- It lives at the root deliberately. Claude Code, Cursor, Copilot and similar
  tools auto-load a root-level `AGENTS.md` and **do not** search `docs/`. A
  ruleset filed under `docs/` would never be found automatically.
- Generated from the `docs-scaffold` template. The single source for all
  projects is `Infra/templates/docs-scaffold/`.

If a future tool-specific instruction file is added, it must **not** contradict
this file. Reconcile rather than duplicate.

---

**When in doubt: read the code, make the smallest correct change, run the
checks, update the docs, and report honestly what you verified.**