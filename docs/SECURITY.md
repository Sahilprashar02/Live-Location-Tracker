# Live Location Tracker — Security

> Controls that exist, and gaps that do not. Both matter.
> Filled from the implementation and live headers on 2026-10-20.

---

## 1. Security Model

Trust boundaries:

1. **Browser → Vercel.** The browser is untrusted. It can forge any
   `send-location`, call any HTTP route, and modify `localStorage`.
2. **Vercel → backend (HTTP).** Vercel rewrites `/auth/*` and `/api/*`. The
   backend must still authenticate every protected request; it does not trust
   the frontend.
3. **Browser → backend (Socket.IO).** The WebSocket bypasses Vercel. The socket
   handshake is authenticated with a JWT, a session cookie, or a share code.
4. **Backend → MongoDB/Kafka.** Both are on the shared
   `platform-network`; neither is exposed to the public internet.
5. **Third-party APIs.** Google, Esri, OSM, Nominatim, OSRM, Open-Meteo,
   ui-avatars, and CDNs are trusted for their own data but are not
   authenticated identity providers for this app.

The server treats `displayName`, `avatar`, email, coordinates, accuracy, share
duration, and geofence fields as untrusted input.

---

## 2. Controls That Are Verified Present

| # | Control | Where | Status |
|---|---|---|---|
| S1 | Google OAuth 2.0 sign-in with `profile` and `email` scopes | `backend/src/config/passport.js`, `routes/auth.js` | VERIFIED |
| S2 | JWT signed with `SESSION_SECRET`, 24-hour expiry | `routes/auth.js` | VERIFIED |
| S3 | Session cookie is `httpOnly`, `secure`, `sameSite:'none'`, 1-day max age | `server.js` | VERIFIED |
| S4 | `requireAuth` checks the session first, then a Bearer JWT, and loads the user from MongoDB | `middleware/auth.js` | VERIFIED |
| S5 | Friends and geofences routers apply `requireAuth` to every route | `routes/friends.js`, `routes/geofences.js` | VERIFIED |
| S6 | Share creation/stop and all private reads are scoped to `req.authUser._id` | `routes/share.js` | VERIFIED |
| S7 | Geofence creation requires an accepted `Friend` row for the target | `routes/geofences.js` | VERIFIED |
| S8 | Geofence PATCH uses a key allow-list and `runValidators` | `routes/geofences.js` | VERIFIED |
| S9 | No `...req.body` spread anywhere in the backend | `grep` across `backend/src` | VERIFIED |
| S10 | Socket handshake requires a valid JWT, session, or active share code | `server.js` `io.use(...)` | VERIFIED |
| S11 | Socket location data is range-validated (lat −90..90, lng −180..180, numeric) | `socket/handler.js` | VERIFIED |
| S12 | Socket location updates are rate-limited to 1 per user per 3 s | `socket/handler.js` | VERIFIED |
| S13 | CORS is restricted to the exact `CLIENT_URL` with credentials | `server.js` | VERIFIED |
| S14 | `express.json()` uses the default 100 kB body limit | `server.js` | VERIFIED |
| S15 | Docker image runs as non-root `appuser` (uid 1001) | `backend/Dockerfile` | VERIFIED |
| S16 | Backend container publishes **no host port**; nginx reaches it over `platform-network` | `docker-compose.prod.yml` | VERIFIED |
| S17 | `.env` is excluded from git, the Docker build context, and the rsync deploy | `.gitignore`, `backend/.dockerignore`, `.github/workflows/deploy.yml` | VERIFIED |
| S18 | Startup fails when a required variable is missing | `server.js` `validateEnv()` | VERIFIED |
| S19 | `/health` returns 503 when MongoDB is disconnected | `server.js` | VERIFIED |
| S20 | Vercel adds `Cache-Control: no-store` to `/auth/*` and `/api/*` | `frontend/vercel.json` | VERIFIED |
| S21 | Vercel sends HSTS (`max-age=63072000; includeSubDomains; preload`) | live response headers | VERIFIED |
| S22 | nginx adds `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `X-XSS-Protection`, and `Referrer-Policy` | live response headers | VERIFIED |
| S23 | `/metrics` is scraped only over `platform-network`; the public nginx vhost returns `404` and the backend publishes no host port | `Infra/nginx/conf.d/llt.conf`, `docker-compose.prod.yml` | VERIFIED |

“Verified” here means the code or a live response was inspected. It does not
mean an independent penetration test was performed.

---

## 3. Authentication

### 3.1 Mechanisms

| Mechanism | Used for | Status |
|---|---|---|
| Google OAuth 2.0 + Passport session | Browser login; session fallback for HTTP and socket | VERIFIED |
| JWT (HS256 by default, `jsonwebtoken` 9.0.3) | Cross-domain HTTP and Socket.IO auth; stored in `localStorage` | VERIFIED |
| Share code | Guest Socket.IO access to one owner's live updates | VERIFIED |
| Session cookie (`connect.sid`) | Passport session, Mongo-backed, 1-day TTL | VERIFIED |

### 3.2 Token Lifecycle

| Aspect | Value |
|---|---|
| JWT storage | `localStorage` key `auth_token` (`frontend/js/auth.js`); also briefly in the URL query after OAuth |
| JWT expiry | 24 hours; no refresh token |
| JWT revocation | **None.** There is no denylist or `tokenVersion`; logout cannot invalidate an issued JWT |
| Session storage | MongoDB via `connect-mongo`, collection managed by the library |
| Session expiry | 1 day (`cookie.maxAge` and store `ttl`) |
| Session revocation | `req.session.destroy()` on logout clears the current session |
| Share-code expiry | `expiresAt` (`1h`, `8h`, or null for forever) plus `isActive`; checked in HTTP and socket |
| Share-code revocation | `POST /api/share/:code/stop` sets `isActive:false` and notifies the room |
| Password | None — authentication is delegated to Google |

A stateless JWT cannot be revoked. Saying so is useful; implying otherwise is
not.

### 3.3 OAuth state

Passport's OAuth2 strategy is constructed **without** `state: true`; the
strategy therefore uses the null state store. The OAuth `state` parameter is
not generated or verified, so the login flow does not have OAuth state CSRF
protection. This is recorded in §9. **VERIFIED**

---

## 4. Authorization

There is **no role or permission layer**. Every authenticated user has the same
capabilities. Access is decided by ownership and relationship checks:

| Resource | Rule |
|---|---|
| Share sessions | `POST /create` uses the caller's id; `GET /my-sessions`, `POST /:code/stop` filter by `ownerId: req.authUser._id`. Public `GET /:code` intentionally bypasses auth. |
| Friends | `GET /` reads outgoing rows (accepted and pending) plus pending incoming rows; accepted pairs have a reciprocal row, so both sides appear from the caller's `userId` side. `DELETE /:id` removes only rows involving the caller. `accept` requires the caller to be the `friendId` on a pending incoming request. |
| Geofences | `GET`, `PATCH`, `DELETE` filter by `userId: req.authUser._id`; `POST` requires an accepted `Friend` row for the target. |
| Location broadcasts | The broadcast consumer sends to the owner, accepted friends, and active share rooms. |
| Socket rooms | Authenticated users join `user:<their id>`; share guests join one `share:<code>` room. |

`ShareSession.allowedViewers` is **not** consulted by the public endpoint or
the share socket. A creator cannot restrict a link to specific viewers even
though the field exists. The UI does not expose the field today.

---

## 5. Input Validation

| # | Risk | Mitigation | Status |
|---|---|---|---|
| 1 | Invalid/spoofed coordinates | Numeric type and range check in `validateLocationData` before Kafka | VERIFIED |
| 2 | Mass assignment | No `...req.body`; explicit field reads; geofence PATCH allow-list | VERIFIED |
| 3 | NoSQL injection via query operators | Values are cast by Mongoose; share code is matched as a string; friend email is escaped before regex use | VERIFIED |
| 4 | Friend email enumeration | `POST /api/friends/request` returns `404` with “No user found with that email,” which reveals whether an email is registered | VERIFIED (gap) |
| 5 | Invalid ObjectIds | `accept` validates; friend delete and geofence delete do not, so invalid ids can become 500s | VERIFIED (gap) |
| 6 | Oversized body | Express default 100 kB limit | VERIFIED |
| 7 | XSS in rendered display names | `sharing.js` and `geofencing.js` escape; `app.js` and `map.js` interpolate `displayName` into `innerHTML`/popup HTML without escaping | VERIFIED (gap) |
| 8 | Share `allowedViewers` entries | Only checked to be an array; entries are not validated as user ids | VERIFIED (gap) |
| 9 | Geofence `center` shape | Mongoose nested schema validation (`lat`/`lng` required, ranges) | VERIFIED |

The XSS chain matters because the JWT lives in `localStorage`: a stored script
in a display name could read and exfiltrate the token. No CSP is present to
mitigate it.

---

## 6. Secrets Management

| Aspect | State | Status |
|---|---|---|
| `.env` git-ignored | `.env`, `.env.local`, `.env.*.local`, `.env.production`, `.env.development`, `.env.test`, and their `.local` variants are ignored, while `.env.example` and `.env.production.example` are explicitly re-included | VERIFIED |
| Excluded from build context | `backend/.dockerignore` excludes `.env` and `.env.*` (re-includes `.env.example`) | VERIFIED |
| Excluded from deploy | Deploy rsync excludes `.env` and `.env.*`; it never overwrites the server `.env` | VERIFIED |
| Tracked example files | `backend/.env.example` and `.env.production.example` contain `your_...` / `CHANGE_ME` placeholders only | VERIFIED (scan) |
| Start-up guard | `validateEnv()` exits when a required variable is missing, but does **not** reject placeholder values or enforce secret length/entropy | VERIFIED (gap) |
| Server file mode | `/opt/apps/live-location-tracker/.env` is mode `600` on the server | VERIFIED |
| Logging | No code logs a password, JWT, session cookie, Google secret, Mongo URI, or Kafka credential | VERIFIED (review) |

`SESSION_SECRET` signs both the session and the JWT. It must be a high-entropy
value; rotating it logs everyone out and invalidates all JWTs.

The production `.env` is not in this repository and must never be committed,
printed, or copied into documentation. The examples are placeholders.

Verified example scan command:

```bash
grep -rnE "mongodb(\+srv)?://[^ ]*:[^ ]*@|AKIA|sk_live|AIza|-----BEGIN|(PASSWORD|SECRET|CLIENT_SECRET)=[^C]" \
  --include='*.example' .
```

No real credential was found in the examples during this pass.

---

## 7. Transport and Browser Security

| Control | Where | Status |
|---|---|---|
| TLS for the Vercel frontend | Vercel | VERIFIED (HTTPS 200) |
| TLS for the backend origin | `global-nginx` (nginx 1.27.5) | VERIFIED (HTTPS 200) |
| HSTS | Vercel response header; **not observed** on the direct backend response | VERIFIED (Vercel) / gap (backend) |
| Secure session cookie | `secure: true`, `sameSite: 'none'` | VERIFIED |
| httpOnly session cookie | `httpOnly: true` | VERIFIED |
| CORS allow-list | Exact `CLIENT_URL`, `credentials: true` | VERIFIED |
| CSRF token | **None** | Gap — state-changing routes are JSON POST/PATCH/DELETE, which trigger CORS preflight; state-changing GET `/auth/logout` is CSRF-able as a logout nuisance |
| CSP | **None** for application responses | Gap |
| `X-Powered-By` | `Express` is sent | Gap (fingerprinting) |
| `X-Frame-Options` / `nosniff` / `Referrer-Policy` | Added by nginx | VERIFIED |
| Duplicate `X-Content-Type-Options` | nginx sends it twice | Cosmetic (VERIFIED) |
| Service worker scope | Caches **all same-origin GETs**, including `/auth/me`, `/api/friends`, and `/api/share/:code`, plus map tiles. `caches.match` keys on URL/method, not `Authorization`; Vercel's `no-store` does not prevent the Cache API from storing the response. | **Gap** (`frontend/public/sw.js`) |

`app.set('trust proxy', 1)` assumes one trusted proxy. The HTTP path is
Vercel → nginx → app, so `req.ip` is the immediate proxy's address, not the
end user's. No application code currently uses `req.ip` for authorization or
rate limiting. Changing `trust proxy` is a security control (see
[AGENTS.md](../AGENTS.md) G10).

---

## 8. Rate Limiting

| Scope | Limit | Storage | Status |
|---|---|---|---|
| Socket location events | 1 per user per 3 s; excess silently dropped | In-memory `Map` | VERIFIED |
| Client location sends | At most 1 per 5 s | Browser state | VERIFIED |
| Socket reconnection | 10 attempts, 1 s–10 s backoff | Client | VERIFIED |
| HTTP auth/API/share | **None** | — | Gap |
| Share-code guessing | **None** | — | Gap |

The socket limiter does not survive a restart and is not shared across
processes. There is one process today, so it works as intended for the current
deployment; it would silently stop limiting if replicas were added.

---

## 9. Verified Security Gaps

| # | Gap | Severity | Evidence |
|---|---|---|---|
| 1 | Stored XSS via `displayName` in `app.js` online list and `map.js` popup HTML; `localStorage` JWT can be stolen | **High** | `frontend/js/app.js` user-list template; `map.js` `createPopupContent`/`createMarkerIcon`; no escaping helper in those files |
| 2 | JWT is placed in the OAuth redirect query string (`/?token=...`) and can leak via history, Referer, proxy/browser logs before the frontend strips it | **Medium** | `backend/src/routes/auth.js`; `frontend/js/auth.js` |
| 3 | JWT is stored in `localStorage`, so any XSS is token theft | **Medium** | `frontend/js/auth.js` |
| 4 | No JWT revocation; logout leaves a valid token until 24 h expiry | **Medium** | `routes/auth.js`; `middleware/auth.js` |
| 5 | OAuth `state` is not enabled/verified | **Medium** | `config/passport.js` strategy constructed without `state:true`; passport-oauth2 uses `NullStore` |
| 6 | `allowedViewers` is stored but not enforced; a share link is visible to anyone with the code | **Medium** (latent; UI does not expose it) | `routes/share.js`; `socket/handler.js` |
| 7 | No HTTP rate limiting on auth, share lookup, or friend lookup | **Medium** | No limiter middleware |
| 8 | Public share codes have 40 bits of entropy and no lookup throttling | **Low–medium** | `crypto.randomBytes(5)` |
| 9 | No application CSP or `helmet`; `X-Powered-By: Express` | **Low** | `server.js`; live headers |
| 10 | No custom error handler; default Express errors may include stack detail outside production | **Low** | `server.js`; no error middleware |
| 11 | Friend lookup reveals whether an email is registered (`404`) | **Low** | `routes/friends.js` |
| 12 | `DELETE` routes accept malformed ids and can return 500 | **Low** | `routes/friends.js`; `routes/geofences.js` |
| 13 | Startup guard accepts `CHANGE_ME` placeholder secrets if copied from the example | **Low** | `validateEnv()` only checks presence |
| 14 | No account deletion/data export; location history is only bounded by the 24 h TTL | **Low** (privacy) | No endpoint; `LocationHistory` TTL |
| 15 | `npm audit` reports a critical `proxy-addr` advisory and other backend issues; frontend dev toolchain has high advisories | **High** (dependency) | See §10 |
| 16 | Public OSRM/Nominatim/tile usage has no SLA or fallback | **Low** (availability) | Frontend call sites |
| 17 | Service worker serves same-origin API GETs cache-first; the cache key ignores `Authorization`, so `/auth/me`, `/api/friends`, and `/api/share/:code` can be served stale or to the next user after logout | **High** (privacy/auth state) | `frontend/public/sw.js` fetch handler: `isAppAsset` includes `/api`, `caches.match` ignores headers, cache is not cleared on logout |

Gaps are recorded, not fixed, in this documentation change. Fixing them
requires human authorisation and a separate code change.

---

## 10. Dependencies

`npm audit` was run in both packages on 2026-10-20. No dependency was upgraded
during this documentation pass.

### Backend (`npm audit --omit=dev`)

**10 vulnerabilities: 6 moderate, 3 high, 1 critical.**

| Package | Severity | Advisory (summary) | Fix |
|---|---|---|---|
| `proxy-addr` | **Critical** | IP spoofing via IPv4-mapped IPv6 trust subnet | `npm audit fix` (non-major) |
| `engine.io` | High | Engine.IO protocol revision mismatch DoS | `npm audit fix` |
| `socket.io-parser` | High | Zero-attachment memory exhaustion | `npm audit fix` |
| `ws` | High | Uninitialized memory disclosure; memory-exhaustion DoS | `npm audit fix` |
| `express` | Moderate | `qs` | `npm audit fix` |
| `body-parser` | Moderate | Invalid `limit` disables size enforcement; `qs` | `npm audit fix` |
| `mongoose` | Moderate | Prototype pollution in update casting via `__proto__`-prefixed dotted path | `npm audit fix` |
| `qs` | Moderate | Several remotely triggerable DoS issues | `npm audit fix` |
| `socket.io-adapter` | Moderate | Depends on vulnerable `ws` | `npm audit fix` |
| `uuid` | Moderate | Missing buffer bounds check in v3/v5/v6 when `buf` is provided | **Breaking major** (`uuid@14`) |

The critical `proxy-addr` issue is mitigated in practice by the fact that the
backend has no published host port and only nginx can reach it, but the package
is still vulnerable. Do not run `npm audit fix --force` or upgrade `uuid` to a
major version without reviewing the change.

### Frontend (`npm audit`)

**5 vulnerabilities: 1 moderate, 4 high, 0 critical.** These are in the
Vite/build toolchain (`vite`, `esbuild`, `postcss`, `source-map-js`,
`nanoid`), not in the shipped application code. The Vite fix is a **breaking
major** (`vite@8`); `npm audit fix` can address some advisories.

### Runtime packages (not audit results)

| Package | Installed version |
|---|---|
| `express` | 4.22.2 |
| `socket.io` | 4.8.3 |
| `mongoose` | 8.23.1 |
| `kafkajs` | 2.2.4 |
| `jsonwebtoken` | 9.0.3 |
| `passport` / `passport-google-oauth20` | 0.7.0 / 2.0.0 |
| `connect-mongo` | 5.1.0 |
| `express-session` | 1.19.0 |
| `vite` (frontend dev) | 5.4.21 |

---

## 11. Rules for Every Future Change

1. Never weaken a control to unblock a task.
2. Every new endpoint is authenticated by default; justify any public route in
   [API.md](./API.md) §4.
3. Allow-list input. Never spread `req.body`.
4. Never log a secret, token, or personal identifier in full.
5. Never return internal error detail in production.
6. Do not change `trust proxy`, middleware ordering, CORS, or cookie settings
   without a security review.
7. Do not add replicas or a Socket.IO adapter without revisiting the in-memory
   rate limiter and session model.
8. Fixing any gap in §9 requires explicit authorisation and a test.
