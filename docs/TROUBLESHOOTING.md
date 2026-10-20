# Live Location Tracker — Troubleshooting

> Diagnose by symptom, not by guessing.
> Filled from the implementation and live deployment on 2026-10-20.

---

## 1. Quick Diagnosis

| Symptom | Go to |
|---|---|
| Container is restarting / unhealthy | [§3 Server startup](#3-server-startup) |
| `/health` returns 503 | [§4 Database](#4-database) |
| Google says `redirect_uri_mismatch` | [§5 Authentication](#5-authentication) |
| Google says `invalid_client` | [§5 Authentication](#5-authentication) |
| Login succeeds but the app shows the login screen again | [§5 Authentication](#5-authentication) |
| CORS error in the browser console | [§6 API](#6-api) |
| Every API route returns 500 | [§6 API](#6-api) |
| API works but live markers do not move | [§7 Frontend](#7-frontend) |
| Socket stuck on “Reconnecting…” | [§7 Frontend](#7-frontend) |
| Map is blank / tiles fail | [§7 Frontend](#7-frontend) |
| `/track/<code>` returns 404 | [§7 Frontend](#7-frontend) |
| Logout still shows the previous user / stale friend data | [§7 Frontend](#7-frontend) |
| Search or directions fail | [§8 Third-Party Failures](#8-third-party-failures) |
| Local `npm run build` fails | [§9 Tests](#9-tests) |
| CI deploy fails | [§6 API](#6-api) / [DEPLOYMENT.md](./DEPLOYMENT.md) |

---

## 2. First Checks

Run these before changing anything. They answer most problems without touching
shared infrastructure.

```bash
# 1. Public health (readiness-aware: 200 only when Mongo is connected)
curl -sS -i https://llt.140-245-27-200.sslip.io/health

# 2. Public auth path through the Vercel rewrite
curl -sS -i https://live-location-tracker-jade.vercel.app/auth/me

# 3. Container state and recent logs
ssh oracle 'docker inspect --format="{{.State.Status}} {{.State.Health.Status}} {{.RestartCount}}" llt-backend'
ssh oracle 'cd /opt/apps/live-location-tracker && docker compose -f docker-compose.prod.yml logs --tail=100 backend'

# 4. Shared services (do NOT restart them; just observe)
ssh oracle 'docker ps --format "table {{.Names}}\t{{.Status}}" | grep -E "llt-backend|global-(nginx|mongodb|kafka)"'
```

Do not print `.env`, `docker compose config`, or the backend's process
environment. If you need to check which variables are missing, print only the
**names**:

```bash
ssh oracle 'docker exec llt-backend node -e "console.log([\"GOOGLE_CLIENT_ID\",\"GOOGLE_CLIENT_SECRET\",\"SESSION_SECRET\",\"MONGODB_URI\",\"KAFKA_BROKER\",\"PORT\"].filter(k=>!process.env[k]))"'
```

An empty array means all required names are present. It does not prove the
values are valid.

---

## 3. Server Startup

### The server exits immediately

`bootstrap()` first calls `connectDB()`, which does
`mongoose.connect(process.env.MONGODB_URI)` and calls `process.exit(1)` on
failure. Before that, `validateEnv()` exits if a required variable is missing.

Check in this order:

1. `docker compose logs --tail=100 backend` for the exact error.
2. Is `MONGODB_URI` present and does it point at `global-mongodb:27017` with
   the right database and `authSource`?
3. Is `global-mongodb` running and healthy?
4. Is the Mongo user/password correct? Do not print the URI or password.
5. Is `PORT` set? `validateEnv` requires it even though the code has a `3000`
   fallback. Production sets `5000` in compose.
6. Is the container on `platform-network`?

### A required variable is missing

The process prints:

```text
❌ Missing required environment variables: NAME, NAME
```

and exits with code 1. The Docker healthcheck never passes and the container
restarts under `restart: unless-stopped`.

The guard only checks **presence**. A value of `CHANGE_ME` is accepted. If the
container starts but auth/Mongo fails, suspect a placeholder copied from an
example file.

### Kafka initialization failed

This is logged but **not fatal**:

```text
❌ Kafka initialization failed: ...
```

The HTTP server and socket handshake still work; `send-location` emits
`error-message` and live updates/history stop. Check:

```bash
ssh oracle 'docker inspect --format="{{.State.Status}} {{.State.Health.Status}}" global-kafka'
ssh oracle 'docker logs --tail=100 global-kafka'
ssh oracle 'docker exec global-kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --list'
```

Do not create a second broker. `KAFKA_BROKER` in production is
`global-kafka:9092`.

### Port already in use

The container listens on `5000` internally. If a stale container or process
holds it, logs show `EADDRINUSE`. Check `docker ps` for a duplicate
`llt-backend`; do not kill unrelated containers.

---

## 4. Database

### Health reports a failure

`GET /health` checks `mongoose.connection.readyState` and returns `503` unless
it is `1` (`connected`). It does not run a query or check Kafka.

1. `curl /health` → `{"status":"degraded","database":{"status":"disconnected",...}}`
2. `docker logs llt-backend` for `MongoDB disconnected` / `MongoDB error`.
3. `docker inspect --format="{{.State.Health.Status}}" global-mongodb`.
4. Verify the app can resolve `global-mongodb` on `platform-network`.

A `connecting` state (2) also returns 503; wait for the connection to settle.

### Model init fails

Mongoose creates indexes at model initialisation (`autoIndex` is not disabled).
The usual cause is a **unique index over duplicate data**:

- `User.googleId`
- `Friend.{userId, friendId}`
- `ShareSession.shareCode`
- `LocationHistory.eventId`

The error is `E11000 duplicate key` during index creation. Deduplicate the
collection before adding the index. Check existing indexes with
`db.<collection>.getIndexes()` in `mongosh`. Do not drop a production index
without authorisation.

### A query is slow

There is no APM, profiler, or slow-query log enabled. Options:

```js
// In mongosh, temporarily, on a non-production or authorised session:
db.setProfilingLevel(2)
db.system.profile.find().sort({ ts: -1 }).limit(5)
db.friends.find({ friendId: ObjectId("..."), status: "accepted" }).explain("executionStats")
db.setProfilingLevel(0)
```

The consumer queries `Friend` and `ShareSession` on every location event and
the socket handler queries `Geofence`; these are the first suspects. See
[PERFORMANCE.md](./PERFORMANCE.md) §4.

### TTL is not deleting history

The TTL monitor runs roughly every 60 seconds; deletion is not immediate. If
nothing is deleted after several minutes:

1. `db.locationhistories.getIndexes()` — confirm a `timestamp` index with
   `expireAfterSeconds: 86400`.
2. Check whether the index was changed with `collMod`; Mongoose does not alter
   an existing TTL option automatically.
3. A document whose `timestamp` is not a `Date` is not eligible.

### Sessions are not persisting

`connect-mongo` stores sessions in MongoDB. If the database is down or the
session store errors, login can appear to succeed (JWT in the URL) while the
session cookie path fails. The JWT path is the production primary; check
`/auth/me` with the Bearer token.

---

## 5. Authentication

### `redirect_uri_mismatch`

Google compares the exact callback URI. Check:

- Google Console → Credentials → OAuth client → Authorized redirect URIs
- Production must include
  `https://live-location-tracker-jade.vercel.app/auth/google/callback`
- Server `GOOGLE_CALLBACK_URL` must be exactly that URI (no trailing slash)
- The Vercel rewrite `/auth/:path*` must still point at the live backend
- The old backend-origin callback is not needed

A mismatch happens **before** the request reaches the app.

### `invalid_client`

The client ID/secret pair is wrong or has whitespace/quotes. The values live
only in the server `.env` and Google Console. Do not print them. Rotate the
secret in Google Console if it was exposed, then update `.env` and redeploy.

### Login succeeds but the app returns to the login screen

1. The callback redirects to `CLIENT_URL/?token=...`. If `CLIENT_URL` is wrong
   or unset, the browser goes to the backend origin instead of Vercel.
2. `AuthManager.checkAuth` stores the token and calls `/auth/me`. If that call
   fails, the app shows the login screen.
3. Check the browser Network tab for `/auth/me`: 401 vs 500 vs CORS.
4. Check the application tab: `localStorage.auth_token` should exist after the
   redirect.
5. Check `SESSION_SECRET`: changing it invalidates old JWTs and sessions.

### Sessions do not persist locally

The cookie is configured with `secure: true` and `sameSite: 'none'`. On plain
`http://localhost` the browser will not set a secure cookie. The OAuth JWT
still works, so the map can load, but the Passport session fallback will not.
Use HTTPS locally if you need the session path, or rely on the JWT.

In production, third-party cookie blocking or a cross-site cookie policy can
also drop the session cookie. The JWT is the primary path for this reason.

### A valid token is refused

- It expired (24 hours).
- `SESSION_SECRET` was rotated.
- The user id in the token no longer exists in MongoDB.
- The header is missing or malformed; it must be `Authorization: Bearer <jwt>`.
- The request went to a different backend/environment.
- The token was issued by a different secret (local vs production).

There is no denylist, so “refused” is almost always expiry/signature/user
lookup, not revocation.

### Logout does not invalidate the token

Expected. Logout removes the browser copy and destroys the session, but a
stateless JWT remains valid until expiry. If a token leaked, rotate
`SESSION_SECRET` (logs everyone out) or add a revocation mechanism. See
[SECURITY.md](./SECURITY.md) §9.

---

## 6. API

### CORS rejects the origin

CORS is only mounted when `CLIENT_URL` is set, and it allows exactly that
origin with credentials. The browser origin must match exactly (scheme, host,
port, no trailing slash mismatch).

- Production browser origin: `https://live-location-tracker-jade.vercel.app`
- Local Vite: set `CLIENT_URL=http://localhost:5173`
- Local backend-served frontend: `http://localhost:3000`

If `CLIENT_URL` is unset, the middleware is not mounted at all; cross-origin
calls fail. Socket.IO has the same origin setting.

### Every route returns 500

Common causes:

1. MongoDB/session store is unavailable → middleware throws.
2. A shared middleware error (Passport/session).
3. An unhandled route error reaches Express's default handler.

There is **no custom error middleware**, so the response may be HTML and may
include a stack outside production. Read the server log for the real error.
Do not add a catch-all that converts 404s into 500s.

### A request returns 401 when it should return 404

`requireAuth` runs before the resource lookup. A missing/invalid token returns
401 even if the resource does not exist or is not owned. That is intentional
for protected routers. The public share GET returns 404 for missing/expired
links because it has no auth middleware.

### A large body is rejected

`express.json()` uses the default 100 kB limit. A request over it returns 413
(`PayloadTooLargeError`). No route needs a larger body today; do not raise the
limit without a review.

### `/` on the backend returns 404

Expected in production. The backend image does not contain `frontend/`, so
`serveFrontend` is false and there is no SPA fallback. The browser should use
the Vercel domain. `/api/*` and `/health` still work.

### CI deploy fails

The workflow fails if:

- `SSH_PRIVATE_KEY` (or `ORACLE_SSH_KEY`) is missing/empty
- `SERVER_HOST` (or `ORACLE_HOST`) is missing
- `SERVER_HOST` is a local SSH alias such as `oracle` instead of the resolvable
  host/IP; it must be `140.245.27.200`
- rsync/SSH authentication fails
- `scripts/deploy.sh` fails its `.env`/network preflight
- the container never becomes healthy within 150 s

Read the Actions log for the failing step. `SERVER_HOST` must be the bare host,
not `ubuntu@...`. The private key is the **private** key, not `.pub`.

---

## 7. Frontend

### The frontend cannot reach the API

In production, HTTP is same-origin and relies on `frontend/vercel.json`:

```json
{ "source": "/api/:path*", "destination": "https://llt.140-245-27-200.sslip.io/api/:path*" }
```

Check:

1. `curl -i https://live-location-tracker-jade.vercel.app/auth/me` → 401 JSON
2. `curl -i https://live-location-tracker-jade.vercel.app/api/share/nope` → 404 JSON
3. Vercel deployment includes the latest `vercel.json`
4. The backend origin is healthy
5. Not a mixed-content or extension/CSP issue

Local Vite uses `http://localhost:3000` directly; the backend must be running
and `CLIENT_URL` must allow `:5173`.

### Socket stuck on “Reconnecting…”

Socket.IO bypasses Vercel and connects to the backend origin from
`VITE_SOCKET_URL` or `VITE_API_BASE`. If both are missing in production, it
falls back to `window.location.origin` (Vercel), which cannot proxy the
WebSocket.

Check:

1. Browser Network → WS connection to the backend origin, not Vercel
2. `VITE_API_BASE`/`VITE_SOCKET_URL` in the Vercel build environment
3. Handshake returns `0{"sid":...}`:
   `curl "https://llt.140-245-27-200.sslip.io/socket.io/?EIO=4&transport=polling"`
4. The JWT exists in `localStorage`; a missing/expired token rejects the socket
5. `CLIENT_URL` matches the browser origin for socket CORS
6. nginx is forwarding the upgrade (`Upgrade`/`Connection` headers)
7. The client retries 10 times, then shows “Connection failed”; log in again
   to get a fresh token

### Map is blank

- Check the Network tab for tile requests.
- Dark/Light use keyless Esri tiles; Standard uses OSM; Terrain uses
  OpenTopoMap. A provider outage shows blank tiles; switch layers.
- Confirm Leaflet loaded from unpkg. If the CDN is blocked, `L` is undefined
  and the map never initialises.
- Attribution is hidden by CSS; that does not cause a blank map.

### `/track/<code>` returns 404

The SPA fallback in `frontend/vercel.json` must be deployed. Test
`https://live-location-tracker-jade.vercel.app/track/test`; it should return
200 HTML. If it 404s, the rewrites are missing or the deployment failed.

### The app looks stale after a deploy

The service worker caches the shell, tiles, and same-origin API GETs under
`live-map-shell-v2` (`frontend/public/sw.js`). A new build, an `/auth/me`
response, or a share lookup can still be served from the old cache. Hard-reload,
unregister the worker, or bump the cache name when assets change. The cache is
**not** cleared on logout; clear site data on a shared device.

### Logout still shows the previous user or stale friend data

The service worker caches same-origin GETs, including `/auth/me` and
`/api/friends`, and the cache key does not include the `Authorization` header.
After logout the app can receive a cached 200 for `/auth/me`. Clear the site's
storage/cache (DevTools → Application → Storage → Clear site data), then sign in
again. This is a known gap; do not treat logout as a shared-device privacy
boundary until the worker excludes `/api/*` and `/auth/*`.

### Search/directions/weather fail

See [§8](#8-third-party-failures). These are browser-side calls; the backend
logs will not show them.

### Local `npm run build` fails with `@rollup/rollup-*`

The local `node_modules` is missing Rollup's platform-specific optional
dependency. This is an install problem, not a source error. Do not edit the
source to work around it. Reinstall dependencies consistently (authorisation
required) or rely on the Vercel build. The live site builds successfully.

---

## 8. Third-Party Failures

| Failure | Symptom | What to do |
|---|---|---|
| Google OAuth down/misconfigured | `redirect_uri_mismatch`, `invalid_client`, consent error | Fix Console URI/client; check `GOOGLE_CALLBACK_URL`; check Vercel rewrite |
| MongoDB down | `/health` 503; 500s; socket auth fails | Check `global-mongodb`; do not restart shared infra without authorisation |
| Kafka down | Map works, live updates stop; `error-message` “Failed to process location” | Check `global-kafka`; app will retry; no need to restart the app |
| nginx down | Both API and socket fail | Check `global-nginx`; it is shared |
| Vercel down | Frontend unavailable; backend `/health` still works | Check Vercel status/deployment |
| Esri/OSM/OpenTopoMap down | Blank/grey tiles | Switch layer; wait; no app fix |
| Nominatim down/limited | Search/POI/reverse empty or error text | Wait; reduce request rate; no fallback |
| OSRM down | Route error | Wait; no fallback router |
| Open-Meteo down | Weather hidden; console warning | Expected degradation |
| `ui-avatars.com` down | Broken fallback avatar | Expected; no critical impact |
| unpkg/cdn.socket.io/cdnjs down | No map/socket/QR | CDN outage; no local fallback; restore network/CDN |

Browser console errors for third-party fetches are the primary evidence; server
logs will not contain them.

---

## 9. Tests

### There are no tests

Do not look for a test command that does not exist. `backend/package.json` has
`start`/`dev`; `frontend/package.json` has `dev`/`build`/`preview`. The repo has
no test files or CI test job.

### A local build fails but Vercel succeeds

The local `frontend/node_modules` is incomplete (Rollup native optional
dependency). Vercel installs its own dependencies. Reinstall locally if you
need to reproduce the build; do not change source to mask an install issue.

### A deploy succeeds but the app is broken

The deploy only polls `/health` (Mongo readiness). It does not test Google
login, the API, or the socket. Run the post-deploy checklist in
[DEPLOYMENT.md](./DEPLOYMENT.md) §8, especially a real sign-in and a live
location round-trip.

### A future test passes locally but fails in CI

CI has no `.env`. Any test that reads ambient configuration must set and
restore it itself. See [TESTING.md](./TESTING.md) §7.

---

## 10. When You Cannot Diagnose

1. Capture the exact error and the command or request that produced it.
2. Note the environment — local, Vercel preview, production, CI.
3. Record the HTTP status and response body (redact tokens/cookies).
4. Check whether it reproduces from a clean browser profile/incognito.
5. Check whether it reproduces with the backend health and a direct socket
   handshake.
6. Report what you ruled out, not just what remains.
7. Do not “fix” a security control or shared infrastructure to make a symptom
   disappear.
