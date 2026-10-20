# Live Location Tracker — Testing

> How to verify a change. Filled from the repository and commands run on
> 2026-10-20.

---

## 1. What Exists

| Aspect | Value |
|---|---|
| Runner | **None.** No Jest/Vitest/Mocha/Node test runner configuration exists. |
| Location | No `*.test.js`, `*.spec.js`, `__tests__/`, or `test/` directory. |
| Suites | None. |
| Tests | **0.** There are no test blocks and no assertions. |
| Linter / type checker | None. No ESLint, Prettier, or TypeScript configuration. |
| CI test job | None. |

The backend `package.json` has only `start` and `dev`; the frontend has only
`dev`, `build`, and `preview`. Do not claim “tests pass” — there are no tests to
run.

---

## 2. Commands

These are the commands the repository actually supports. “Ran” records what was
executed during this documentation pass.

| Command | Run when | Gate? | Ran? |
|---|---|---|---|
| `cd backend && npm run dev` | Local backend with `node --watch`; requires a complete `backend/.env` | No | **No** — would need secrets, and this pass was documentation-only |
| `cd backend && npm start` | Production-style backend start; requires env | No | **No** — same reason |
| `cd frontend && npm run dev` | Vite dev server on `http://localhost:5173`; needs the backend at `:3000` and `CLIENT_URL` for CORS | No | **No** |
| `cd frontend && npm run build` | Build the static frontend | No | **Yes — failed** (see below) |
| `node --check <file>` | Backend syntax check | No | **Yes — passed** for every `backend/src/**/*.js` |
| `bash -n scripts/deploy.sh` | Shell syntax check | No | **Yes — passed** |
| `bash -n scripts/install-nginx-vhost.sh` | Shell syntax check | No | **Yes — passed** |
| `bash -n scripts/server-setup.sh` | Shell syntax check | No | **Yes — passed** |
| `cd backend && npm audit --omit=dev` | Dependency advisory check | No | **Yes — 10 findings** |
| `cd frontend && npm audit` | Dependency advisory check | No | **Yes — 5 findings** |
| `curl` the live URLs | Deployment smoke check | No | **Yes — see §3** |

### Local build result

`cd frontend && npm run build` currently fails on this workstation:

```text
Error: Cannot find module @rollup/rollup-darwin-arm64.
npm has a bug related to optional dependencies ...
```

The failure is in the local `frontend/node_modules` installation (the Rollup
native optional dependency is missing), not in the application source. It was
**not** fixed because reinstalling/upgrading dependencies requires
authorisation. Vercel builds the same `frontend/` directory successfully; the
live site serves a hashed bundle. Treat the local build as **unverified** until
`node_modules` is reinstalled consistently.

---

## 3. What Was Actually Verified

### 3.1 Syntax

- Every backend JavaScript file passed `node --check`.
- `scripts/deploy.sh`, `scripts/install-nginx-vhost.sh`, and
  `scripts/server-setup.sh` passed `bash -n`.

### 3.2 Live smoke checks (2026-10-20)

| Check | URL | Result |
|---|---|---|
| Backend health | `GET https://llt.140-245-27-200.sslip.io/health` | `200`, `{"status":"ok",...,"database":{"status":"connected","readyState":1}}` |
| Unauthenticated `/auth/me` | `GET https://live-location-tracker-jade.vercel.app/auth/me` | `401`, `{"success":false,"message":"Not authenticated"}` |
| Public share lookup, missing code | `GET .../api/share/does-not-exist` | `404`, `{"success":false,"message":"This share link is inactive or expired"}` |
| SPA share route | `GET .../track/test` | `200` (serves the app shell) |
| Frontend root | `GET .../` | `200` |
| Socket.IO polling handshake | `GET .../socket.io/?EIO=4&transport=polling` | `200`, Engine.IO open packet with `sid`, `upgrades:["websocket"]` |
| nginx configuration | `docker exec global-nginx nginx -t` | syntax OK |
| Tracked vhost parity | `scripts/install-nginx-vhost.sh --check` | `check=ok`; installed vhost matches `deploy/nginx/llt.conf` |
| Compound indexes after deploy | `getIndexes()` on `friends`, `sharesessions`, `geofences` | `userId+status`, `friendId+status`, `targetUserId+isActive`, and `ownerId+isActive+expiresAt` present |
| Per-event query plans | `explain()` against empty collections | `IXSCAN` selected for friend, geofence, and active-share queries |
| Shared-network upstream | `docker exec global-nginx wget -qO- http://llt-backend:5000/health` | `200`, database connected |
| Internal metrics | `docker exec global-prometheus wget -qO- http://llt-backend:5000/metrics` | Prometheus text; `llt_active_users`, `llt_location_events_produced_total`, and runtime metrics present |
| Public metrics block | `GET https://llt.140-245-27-200.sslip.io/metrics` | `404`; nginx does not proxy the metrics endpoint |
| Prometheus target | Prometheus `/api/v1/targets` | `llt-backend` is `up` |
| Kafka lag exporter | Prometheus `kafka_consumergroup_lag` | `broadcast-group` and `db-processor-group` both report `0` |
| Bounded HTTP load | 2,000 `GET /health`, 50 concurrent, Node client capped at 1 vCPU | `2000/2000` `200`; `634.52 req/s`; p95 `143.2 ms` |
| HTTP to HTTPS | `GET http://llt.140-245-27-200.sslip.io/health` | `301` to the HTTPS URL |
| Public TLS | `GET https://llt.140-245-27-200.sslip.io/health` | `200`, certificate verified (`ssl_verify_result=0`), HTTP/2 |
| WebSocket upgrade through nginx | `wss://llt.140-245-27-200.sslip.io/socket.io/?EIO=4&transport=websocket` | `101 Switching Protocols`, Engine.IO open packet |
| Vercel API rewrite | `GET .../api/friends` | `401` JSON from the backend |
| Vercel OAuth rewrite | `GET .../auth/google` | `302` to `accounts.google.com` |
| Direct backend port | `GET http://140.245.27.200:5000/health` | unreachable; `docker ps` shows `5000/tcp` with no host mapping |

These prove the deployment is reachable, the Vercel rewrites reach the backend,
and the shared nginx path matches the existing apps. They do **not** prove a
Google login, an authenticated Socket.IO session, or a live location round-trip.

### 3.3 Dependency audit

`npm audit` was run in both packages. Results and advisories are recorded in
[SECURITY.md](./SECURITY.md) §10. No dependency was upgraded.

---

## 4. What Is Covered

Only these things are covered today:

- Backend syntax (when `node --check` is run).
- Shell syntax (when `bash -n` is run).
- The deployed health endpoint and public HTTP/socket handshake (manual).
- Prometheus targets, internal `/metrics`, and the public `/metrics` 404 block
  (manual).
- The installed nginx vhost against the tracked copy (manual, read-only).
- The frontend build **on Vercel** (not reproducible locally until
  `node_modules` is repaired).

That is not a test suite. It is a smoke check.

---

## 5. What Is Not Covered

| Area | Untested |
|---|---|
| Auth | No automated test of Google OAuth, the callback, JWT verification, session fallback, logout, or expiry |
| Authorization | No test that a user cannot read/stop another user's share, accept another user's request, or mutate another user's geofence |
| Friends | Request/accept/remove, duplicate requests, self-request, missing user |
| Geofences | Friendship check, radius/name validation, enter/exit/both transitions, `lastState` |
| Locations | Socket validation, 3-second rate limit, Kafka produce/consume, broadcast fan-out, share-room fan-out |
| Persistence | `insertMany` batches, duplicate `eventId` handling, TTL deletion, `lastSeen` update |
| Share links | Create/stop/expiry, public lookup, guest socket, `share-session-ended`, `allowedViewers` (currently unenforced) |
| Frontend | All UI flows, map rendering, search/directions/POI/weather failures, mobile layout, accessibility |
| Security | XSS, CSRF, rate limiting, dependency remediation, header/CSP behavior |
| Load | Authenticated Socket.IO sessions, location writes, Kafka fan-out, and geofence queries; only the bounded public `/health` probe was run |
| Deployment | Rollback, container restart survival, CI failure handling; nginx `--apply` path (only `--check` was run) |

There are no integration, contract, authenticated load, or end-to-end tests.
The full Google sign-in and live location round-trip have **not** been exercised
end to end.

---

## 6. CI

| Job | Runs | Gate |
|---|---|---|
| `Deploy Backend to Oracle Cloud` (`.github/workflows/deploy.yml`) | Push to `main` touching `backend/**`, `scripts/**`, `deploy/**`, `docker-compose.prod.yml`, or the workflow; manual `workflow_dispatch` | **No test gate.** It checks out, rsyncs, SSHes, and runs `scripts/deploy.sh`; the deploy script polls `/health` after recreating the container. It does not install or reload nginx. |
| Vercel frontend build | Git push to `main` via the Vercel Git integration | Not a GitHub Actions job; a failed build does not deploy the frontend |

There is no `ci.yml` and no `needs:` relationship. A failing test (if tests are
added later) will **not** block deployment unless a test job is added and the
deploy job depends on it.

The deploy workflow's only post-deploy verification is the container health
check in `scripts/deploy.sh`; it does not exercise login, the API, or a socket
round-trip.

---

## 7. Environment-Dependent Tests

There are no tests, so there are no tests that read `process.env` today.

The application itself is environment-dependent:

- The backend exits at startup if `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
  `SESSION_SECRET`, `MONGODB_URI`, `KAFKA_BROKER`, or `PORT` is missing.
- Local Vite dev needs `CLIENT_URL` to allow CORS from `:5173`.
- The frontend build reads `VITE_*` at build time (Vercel dashboard values).

If tests are added, they must set and restore their own configuration; they
must not depend on an ambient `.env`, because CI has none. Use the pattern:

```js
const ORIGINAL = process.env.SECRET;
process.env.SECRET = 'test-only-value';
// ... tests ...
if (ORIGINAL === undefined) delete process.env.SECRET;
else process.env.SECRET = ORIGINAL;
```

Never commit a real secret in a test fixture.

---

## 8. Writing Tests

There is no established convention. **PROPOSED** approach, requiring
authorisation before implementation:

1. Use Node's built-in `node:test` and `node:assert/strict` for backend pure
   helpers, so no new dependency is required. Node 22 (the production image)
   supports it.
2. Extract pure helpers for testability where needed (for example
   `validateLocationData` and `haversineMeters` are currently private to
   `socket/handler.js`).
3. Add HTTP integration tests with `supertest` only if the dependency is
   approved; otherwise use `fetch` against a test server.
4. Use a disposable MongoDB/Kafka environment, not production. There is no
   test environment defined today.
5. Add a `test` script to `backend/package.json` and a CI job. Make the deploy
   job depend on it with `needs:`.

Do not add a runner, framework, or fixtures to production code without
explicit authorisation.

---

## 9. Debugging a Failing Check

| Symptom | What to do |
|---|---|
| `node --check` fails | Read the reported file/line; it is a syntax error, not environment |
| Frontend build fails with `@rollup/rollup-*` missing | The local optional dependency is incomplete; do not “fix” source. Reinstall dependencies consistently (authorisation required), or rely on the Vercel build |
| Live `/health` non-200 | `docker compose -f docker-compose.prod.yml logs --tail=100 backend`; check `MONGODB_URI` and `global-mongodb` |
| `auth/me` 500 instead of 401 | Check backend logs for a Mongo/session error; the route normally returns 401 |
| Socket handshake 400/401 | Check `CLIENT_URL`, JWT presence/expiry, and the handshake auth payload |
| `npm audit` findings | Do not run `npm audit fix --force`; review the advisory and plan an upgrade with tests |

There is no test artifact to inspect; capture the exact command, URL, status,
response, and server log line.

---

## 10. Before You Claim a Check Passed

- [ ] Ran the command in **this** session
- [ ] Saw the output
- [ ] The count/status matches what you are about to report
- [ ] If it was a live check, recorded the URL and HTTP status
- [ ] If a check was not run, said so plainly
- [ ] Did not describe the Vercel build as a local build
- [ ] Did not claim tests pass when no test suite exists
