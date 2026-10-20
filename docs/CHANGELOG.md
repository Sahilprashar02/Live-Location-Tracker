# Live Location Tracker — Changelog

> What changed and when. Filled from `git log` on 2026-10-20.

---

## Format

```markdown
## YYYY-MM-DD — <title>

**What changed**
**Why**
**Evidence**
```

---

## Entries

Newest first. Record real commits — a changelog written from memory drifts
from the history within weeks.

## 2026-10-20 — Internal Prometheus metrics and CPU ceiling

**What changed**

Added `backend/src/metrics.js` and `GET /metrics`, backed by
`@prometheus-io/client`. The endpoint exports Node runtime metrics, active
socket/user counts, location events produced/consumed/dropped, geofence alerts,
and HTTP request duration. Added counters to the socket handler and both Kafka
consumers. The public nginx vhost returns `404` for `/metrics`; Prometheus
scrapes `llt-backend:5000` over `platform-network`. Added a 1 vCPU ceiling to
`docker-compose.prod.yml`.

**Why**

The performance review found no app-level metrics, no Kafka consumer-lag
visibility, and no per-container CPU ceiling. These metrics make the next
capacity decision measurable instead of guesswork.

**Evidence**

Commit `52341f2`. Deploy restarted `llt-backend` at `14:55:13 UTC`; `/health`
returned `200`, the internal metrics endpoint returned Prometheus text, and
`https://llt.140-245-27-200.sslip.io/metrics` returned `404`. Prometheus target
`llt-backend` is `up`; `kafka-exporter` reports zero lag for both consumer
groups. A bounded HTTP health probe handled 2,000/2,000 requests at 634.52 req/s
with p95 143.2 ms; no authenticated Socket.IO load test was run.

## 2026-10-20 — Compound indexes for per-event lookups

**What changed**

Added `Friend.{userId,status}`, `Friend.{friendId,status}`,
`Geofence.{targetUserId,isActive}`, and
`ShareSession.{ownerId,isActive,expiresAt}` indexes. The broadcast consumer now
runs its accepted-friend and active-share queries concurrently with
`Promise.all` instead of serially. Query shapes and API/socket contracts did not
change.

**Why**

[PERFORMANCE.md](./PERFORMANCE.md) identified the per-event friend, geofence,
and active-share lookups as missing compound indexes, and the two broadcast
queries were serialized on every location event.

**Evidence**

Commit `6c58709`. The deploy restarted `llt-backend` at `14:08:50 UTC`;
`getIndexes()` confirmed all four indexes, and `explain()` selected `IXSCAN`
for each per-event query against empty collections. `GET /health` returned
`200`; `GET /api/friends` returned `401` as expected. Real-data latency and
throughput remain unmeasured.

## 2026-10-20 — Track nginx vhost and add a safe installer

**What changed**

Added `deploy/nginx/llt.conf`, a tracked copy of the verified shared-nginx
vhost, and `scripts/install-nginx-vhost.sh`. The script defaults to a read-only
`--check`; `--apply` requires `CONFIRM=yes`, installs atomically, runs
`nginx -t`, reloads only on success, and restores the previous file on failure.
CI now syncs `deploy/` to the server but does **not** install or reload nginx.

**Why**

The live reverse proxy was configured only under `/opt/apps/infra/nginx/` on
the server, so it was not reviewable in this repository. Tracking it makes the
setup reproducible without giving the app deploy control over shared nginx.

**Evidence**

`scripts/install-nginx-vhost.sh --check` on the server reported `check=ok`;
the installed vhost matches the tracked copy and `nginx -t` succeeds. Live
HTTPS, HTTP→HTTPS redirect, WebSocket upgrade, and no-host-port checks are
recorded in [TESTING.md](./TESTING.md) §3.2.

---

## 2026-10-20 — Documentation system and agent rules

**What changed**

Installed the `docs-scaffold` documentation system: root `AGENTS.md` plus
`docs/` (architecture, API, database, security, design, testing, UX,
environment, integrations, deployment, performance, troubleshooting, PRD, and
this changelog). Every placeholder was filled from the code or marked
UNKNOWN/INFERRED.

**Why**

Give any AI coding agent, and any new contributor, a single source of truth
that matches the code and records the gaps that were found.

**Evidence**

Working tree at the time of writing; `git status` / `git diff`. Application
code was not changed. Live smoke checks are recorded in
[TESTING.md](./TESTING.md) §3.2, including the shared-nginx reverse-proxy and
WebSocket upgrade checks.

---

## 2026-10-20 — Push-triggered backend deploys

**What changed**

The GitHub Actions workflow now deploys on pushes to `main` that touch
`backend/**`, `scripts/**`, `docker-compose.prod.yml`, or the workflow, in
addition to manual `workflow_dispatch`. Documented the required
`SSH_PRIVATE_KEY` and `SERVER_HOST` values; corrected the host from the local
SSH alias to the bare IP.

**Why**

Manual-only deploys were easy to forget, and the alias `oracle` is not
resolvable on a GitHub runner.

**Evidence**

`dfdc8ce`, `60ef3b7`. Successful run `39367923258`; earlier failures
`39367209718` (missing secrets) and `39367462036` (`SERVER_HOST=oracle`).

---

## 2026-10-20 — Vercel rewrites for HTTP; direct Socket.IO

**What changed**

Added `frontend/vercel.json` rewrites for `/auth/*` and `/api/*` to the backend
origin, an SPA fallback for `/track/:code`, and `Cache-Control: no-store` on
those paths. Frontend HTTP calls became same-origin in production; Socket.IO
keeps using `VITE_SOCKET_URL`/`VITE_API_BASE` because Vercel cannot proxy the
WebSocket upgrade.

**Why**

Hide the raw backend host from the browser address bar and keep API calls on
the Vercel origin without changing the OAuth flow.

**Evidence**

`8c69a8e`, `bf7c7f5`. Live `/auth/me` returns 401 JSON and `/api/share/...`
returns backend JSON through the Vercel domain; `/track/test` returns 200.

---

## 2026-10-20 — Keyless Esri basemaps; stop idle-socket disconnects

**What changed**

Replaced the CARTO Dark/Light basemaps (which now require an API key) with
keyless Esri World Dark/Light Gray Canvas tiles. Bumped the service-worker
cache to `live-map-shell-v2`. Removed the 30-second stale-socket cleanup that
disconnected live sockets when no location arrived; the remaining safety net
only removes sockets that no longer exist.

**Why**

CARTO tile requests failed and blanked the map. The idle disconnect caused a
“Reconnecting…” loop whenever sharing was paused.

**Evidence**

`17a3c3f`. Live bundle verified with zero CARTO references; socket handler
comment documents the orphan-only cleanup.

---

## 2026-10-19 — Backend-only Docker deployment

**What changed**

Added a backend-only production `Dockerfile` (Node 22 Alpine, non-root,
healthcheck), `docker-compose.prod.yml` (`llt-backend`, no host port, 1 GiB
limit, `platform-network`), `scripts/deploy.sh`, `scripts/server-setup.sh`,
`.env.production.example`, the deploy workflow, and the original root
`DEPLOYMENT.md`.

**Why**

Deploy the backend to Oracle Cloud against the shared MongoDB and Kafka without
duplicating or disrupting shared infrastructure.

**Evidence**

`af9a1a5`. Container is healthy; `/health` returns 200 with MongoDB connected.
Earlier failures are recorded in the deployment document.

---

## 2026-06-22 — Weather, POIs, and the premium map UI

**What changed**

Added the live Open-Meteo weather widget, nearby Explore POI filters
(petrol/hospital/food), the glassmorphic layout, OSRM driving/walking/cycling
directions, auto-reroute after 15 m, geocode fallbacks, and inline SVG icons.
Updated the README.

**Why**

Make the map useful beyond a dot: local conditions, nearby destinations, and
routing without leaving the app.

**Evidence**

`8c10f5c`, `3551662`, `37b1284`, `31cfd12`.

---

## 2026-05-13 — Cross-domain JWT auth and Kafka resilience

**What changed**

Added JWT authentication alongside the Passport session for cross-domain
(Vercel/incognito) use, JWT-aware socket auth, CORS/proxy-trust adjustments,
CDN-hosted Socket.IO, hosted Kafka TLS/SASL support, and background Kafka
initialization so a broker outage does not block server startup.

**Why**

The frontend and backend live on different origins; cookie-only auth was
unreliable. Kafka startup was also delaying the HTTP server and failing
deployment health checks.

**Evidence**

`f689a8e`, `b43a254`, `78df751`, `d9c2039`, `95f6d08` and related commits.

---

## Notes

- **Do not** fabricate dates, versions, contributors, or metrics.
- A “fixed” entry with no linked issue or commit is unverifiable.
- Fold a large change into one entry. This is a navigation aid, not a second
  git history.
- The full history is `git log --oneline`.
