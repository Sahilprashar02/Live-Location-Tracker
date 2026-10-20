# Live Location Tracker — API

> Every endpoint, with its auth, validation and side effects.
> Filled from the Express routers and socket handler on 2026-10-20.

**Base URL**

| Environment | URL |
|---|---|
| Local (backend serves the frontend) | `http://localhost:3000` |
| Local (Vite dev server) | Frontend `http://localhost:5173`, API `http://localhost:3000` |
| Production (browser-facing) | `https://live-location-tracker-jade.vercel.app` — `/auth/*` and `/api/*` are Vercel rewrites |
| Production backend origin | `https://llt.140-245-27-200.sslip.io` (not normally navigated to) |

The production frontend uses same-origin HTTP. `frontend/vercel.json` rewrites
`/auth/:path*` and `/api/:path*` to the backend origin. Socket.IO connects
directly to the backend because Vercel cannot proxy the WebSocket upgrade.

---

## 1. Conventions

| Aspect | Convention |
|---|---|
| Auth header | `Authorization: Bearer <JWT>` **or** the `connect.sid` session cookie. `requireAuth` checks the Passport session first, then the Bearer JWT. |
| Success shape | Usually `{ "success": true, ... }`. `GET /health` is the exception: `{ "status": "ok", ... }` with no `success` field. |
| Error shape | Handled errors are `{ "success": false, "message": "..." }`. Unhandled errors go to Express's default handler and may be HTML, not JSON. |
| Pagination | **None.** `GET /api/share/my-sessions` is capped at 20 and sorted by `createdAt` descending; friends and geofences are unbounded. |
| Content type | `application/json` for request bodies. Express's default JSON body limit is 100 kB; no custom limit is set. |
| Versioning | None. Paths are unversioned. |

These are the four things a new contributor gets wrong first.

---

## 2. Authentication

There are three authentication paths:

1. **Google OAuth + Passport session.** `GET /auth/google` redirects to Google.
   The callback creates or updates a `User` with `googleId`, `displayName`,
   `email`, `avatar`, and `lastSeen`. Passport serialises the user id into the
   session, stored in MongoDB by `connect-mongo` (1-day TTL).
2. **JWT.** The callback signs
   `{ id, displayName }` with `SESSION_SECRET`, expires in **24 hours**, and
   redirects to `CLIENT_URL/?token=<jwt>`. The frontend stores it in
   `localStorage` under `auth_token`, strips it from the address bar, and sends
   it as `Authorization: Bearer ...` on HTTP and in the socket handshake.
3. **Share guest.** A Socket.IO connection with
   `auth: { shareCode }` is accepted without a user account if an active,
   unexpired `ShareSession` exists. It joins `share:<code>` and receives only
   that owner's `share-location-update` events.

Refresh/revocation: **none**. There is no refresh token and no denylist. A JWT
is valid until its 24-hour expiry even after logout. Logout removes the local
token and destroys the server session, but cannot revoke an already-issued JWT.

`SESSION_SECRET` signs both the JWT and the Express session. Rotating it
invalidates all JWTs and sessions.

---

## 3. Endpoints

### 3.1 Auth router — `/auth`

| Method | Path | Auth | Validation | Description |
|---|---|---|---|---|
| `GET` | `/auth/google` | Public | None | Redirects to Google with `scope: profile,email`. |
| `GET` | `/auth/google/callback` | Public (Google callback) | OAuth code handled by Passport | Creates/updates the user, signs a 24-hour JWT, redirects to `CLIENT_URL/?token=...`. On OAuth failure redirects to `CLIENT_URL/?error=auth_failed`. |
| `GET` | `/auth/me` | Session **or** Bearer JWT; returns 401 if neither | Valid session or JWT | Returns `{ success, user: { id, displayName, email, avatar } }`. |
| `GET` | `/auth/logout` | No `requireAuth`; uses the session if present | None | Calls `req.logout`, destroys the session, clears `connect.sid`, redirects to `CLIENT_URL`. Does **not** revoke the JWT. |

Notes:

- `CLIENT_URL` is normalised by removing a trailing slash. If it is unset, the
  redirect target is relative to the backend origin.
- `GOOGLE_CALLBACK_URL` is optional; if unset, Passport uses the relative
  `/auth/google/callback` on the backend origin. Production sets it to the
  Vercel domain so the callback travels through the Vercel rewrite.
- The callback's `failureRedirect` only covers Passport's authentication
  failure. A token-exchange/network error thrown inside the strategy is not
  caught by that option and can produce a default 500. **INFERRED**

### 3.2 Share router — `/api/share`

| Method | Path | Auth | Validation | Description |
|---|---|---|---|---|
| `POST` | `/api/share/create` | `requireAuth` | `duration` allow-list (`1h`, `8h`, `forever`); default `1h`. `allowedViewers`, if present, must be an array (contents are not validated). | Creates a `ShareSession` with a 5-byte base64url `shareCode`, sets `expiresAt` (`null` for forever), populates the owner, returns `201 { success, session }`. |
| `GET` | `/api/share/my-sessions` | `requireAuth` | None | Marks the caller's expired active sessions inactive, then returns the latest 20 sessions sorted by `createdAt` descending. |
| `GET` | `/api/share/:code` | **Public** | None beyond the path string | Returns `200 { success, session, latestLocation }` if the session exists and `isAvailable()`; otherwise `404 { success:false, message:"This share link is inactive or expired" }`. `latestLocation` is `null` when no `LocationHistory` point exists. |
| `POST` | `/api/share/:code/stop` | `requireAuth` | Session must belong to the caller | Sets `isActive:false`, emits `share-session-ended` to `share:<code>`, returns `200 { success:true }`; `404` if not owned/found. |

`allowedViewers` is stored but **not enforced** by either the public GET or the
share socket. Treat it as unused metadata.

### 3.3 Friends router — `/api/friends`

Every route in this router uses `router.use(requireAuth)`.

| Method | Path | Auth | Validation | Description |
|---|---|---|---|---|
| `POST` | `/api/friends/request` | Required | Email is trimmed/lowercased, must contain `@`; user lookup uses an escaped anchored regex; self-request rejected | `400` invalid email or self; `404` no user with that email; otherwise upserts `{ userId: caller, friendId: target, status: 'pending' }` and returns `201 { success, request }`. |
| `POST` | `/api/friends/accept/:id` | Required | `:id` must be a valid MongoDB ObjectId | `:id` is the **Friend relationship id**, not the user id. Finds a pending incoming request, sets it `accepted`, upserts the reciprocal accepted row, returns `200 { success:true }`; `400` invalid id; `404` no incoming request. |
| `GET` | `/api/friends` | Required | None | Returns `{ success, friends, incoming, outgoing }` with populated `displayName`, `email`, `avatar`. `friends` are accepted outgoing rows; `incoming` and `outgoing` are pending. |
| `DELETE` | `/api/friends/:id` | Required | No ObjectId check | `:id` is the **friend user id**. Deletes both directional rows and returns `200 { success:true }` even when nothing matched. An invalid id can reach Mongoose and become a 500. |

### 3.4 Geofences router — `/api/geofences`

Every route uses `router.use(requireAuth)`.

| Method | Path | Auth | Validation | Description |
|---|---|---|---|---|
| `GET` | `/api/geofences` | Required | None | Returns the caller's fences, newest first, with `targetUserId` populated (`displayName`, `avatar`). |
| `POST` | `/api/geofences` | Required | Caller must have an accepted `Friend` row for `targetUserId`; Mongoose validates `center.lat/lng`, `radius` 25–100000, `name` ≤80, `triggerOn` enum | `403` if the target is not an accepted friend; otherwise creates the fence with explicit fields and returns `201 { success, geofence }`. |
| `PATCH` | `/api/geofences/:id` | Required | Allow-list: `name`, `radius`, `triggerOn`, `isActive`; `runValidators: true` | Updates only the caller's fence; `404` if not found/owned. |
| `DELETE` | `/api/geofences/:id` | Required | No ObjectId check | Hard-deletes only the caller's fence and returns `200 { success:true }` even if nothing matched. An invalid id can become a 500. |

### 3.5 Health

| Method | Path | Auth | Validation | Description |
|---|---|---|---|---|
| `GET` | `/health` | **Public** | None | Returns `200 { status:"ok", timestamp, database:{status:"connected",readyState:1} }` only when Mongoose is connected; otherwise `503 { status:"degraded", ... }`. Used by the Docker healthcheck and the deploy script. |

### 3.6 Socket.IO events

The handshake accepts `auth: { token }`, `auth: { shareCode }`, or a session
cookie. The connection is rejected with `Unauthorized` if none is valid.

| Direction | Event | Payload | Notes |
|---|---|---|---|
| Client → server | `send-location` | `{ latitude:number, longitude:number, accuracy?:number }` | Range-validated; 3-second per-user rate limit; produces a Kafka event. |
| Client → server | `join-share-session` | `{ shareCode }` | Joins an active share room; emits `error-message` if inactive/expired. |
| Client → server | `leave-share-session` | `{ shareCode }` | Leaves the room. |
| Server → client | `active-users` | `[{ userId, displayName, avatar }]` | Sent once on connect, deduplicated by user id. |
| Server → client | `user-connected` | `{ userId, displayName, avatar }` | Broadcast to other authenticated sockets on a user's first socket. |
| Server → client | `user-disconnected` | `{ userId, displayName? }` | Broadcast when the user's last socket disconnects. |
| Server → client | `location-update` | `{ userId, displayName, avatar, latitude, longitude, accuracy, timestamp }` | Owner, accepted friends, via the broadcast consumer. |
| Server → client | `geofence-alert` | `{ geofenceId, name, targetUserId, targetName, event, latitude, longitude, timestamp }` | Sent to the fence owner on a boundary transition. |
| Server → client | `error-message` | `{ message }` | Invalid location, inactive share, or processing failure. |
| Server → client | `share-session-joined` | `{ shareCode }` | Guest joined an active share. |
| Server → client | `share-location-update` | Same payload as `location-update` | Sent to the share room only. |
| Server → client | `share-session-ended` | none | Emitted when the owner stops the link. |

There are no event versions and no acknowledgement callbacks. Do not rename or
reshape an event without checking both `backend/src/socket/handler.js` and
`frontend/js/socket.js`.

---

## 4. Endpoints Without Auth

| Method | Path | Why it is public | Risk |
|---|---|---|---|
| `GET` | `/health` | Docker/CI/deploy health probe | Reveals only database readiness, not data. Low. |
| `GET` | `/auth/google` | Must be reachable to start OAuth | None beyond normal OAuth surface. |
| `GET` | `/auth/google/callback` | Google redirects here without a local session | Passport validates the authorization code. OAuth `state` is **not** enabled or verified (see SECURITY §9). |
| `GET` | `/auth/me` | Returns 401 without a session/JWT; the frontend calls it before login | No data leak; logs JWT verification errors to the server console. |
| `GET` | `/auth/logout` | Intended to clear the session; no `requireAuth` | A cross-site GET can log a user out (CSRF-style nuisance). No data exposure. |
| `GET` | `/api/share/:code` | A share link must be viewable without an account | Anyone with the 40-bit code can read the owner's latest point and session metadata; no rate limit; `allowedViewers` is ignored. |

Every other route is authenticated. The share code is the **only** bearer
secret for the public link path.

---

## 5. Validation

| Aspect | Rule |
|---|---|
| Library | Hand-rolled checks plus Mongoose schema validation. No `zod`, `joi`, `yup`, or `express-validator`. |
| Strategy | Explicit field reads: `req.body.email`, `req.body.duration`, `req.body.targetUserId`, `req.body.center`, `req.body.radius`, `req.body.name`, `req.body.triggerOn`, and an allow-list for geofence PATCH. **No `...req.body` spread exists** (verified with `grep`). |
| Numeric ranges | `Geofence.center.lat` −90..90, `lng` −180..180, `radius` 25..100000; socket coordinates are range-checked before Kafka. |
| String limits | Geofence `name` ≤80 and trimmed. Friend email uses a basic `@` check, not full RFC validation. |
| ObjectIds | `friends/accept` validates; `friends/delete` and `geofences/:id` do not, so invalid ids can produce a cast error → 500. |
| Share duration | Allow-list `1h`, `8h`, `forever`; anything else becomes `1h`. |
| `allowedViewers` | Type-checked as an array only; entries are not validated as ObjectIds by the route (Mongoose will cast on save). |
| Unknown keys | Ignored for share create (only `duration`/`allowedViewers` read) and geofence PATCH (allow-list). |

---

## 6. Rate Limits

| Scope | Limit | Applied to |
|---|---|---|
| Socket location events | One accepted event per user per **3 seconds**; excess events are silently dropped | `send-location` in `backend/src/socket/handler.js` |
| Client send throttle | At most one send per **5 seconds** | `frontend/js/app.js` (`SEND_INTERVAL`) |
| Socket reconnection | 10 attempts, 1 s initial delay, 10 s max | `frontend/js/socket.js` |
| HTTP endpoints | **None** | No `express-rate-limit` or equivalent |
| Share-link lookups | **None** | Public `GET /api/share/:code` |

The socket limiter is an in-memory `Map`, so it resets on restart and is not
shared across processes. There is exactly one process today.

---

## 7. Errors

| Status | Meaning | Shape |
|---|---|---|
| `200` | Success (read/update) | `{ success:true, ... }` |
| `201` | Created (share session, friend request, geofence) | `{ success:true, ... }` |
| `302` | OAuth/login/logout redirect | `Location` header |
| `400` | Invalid input (email, self-request, invalid ObjectId) | `{ success:false, message }` |
| `401` | Missing/invalid auth | `{ success:false, message:"Authentication required" }` or `"Not authenticated"` |
| `403` | Authenticated but not allowed (geofence target not an accepted friend) | `{ success:false, message }` |
| `404` | Missing/expired share, friend request, geofence, or user | `{ success:false, message }` |
| `500` | Unhandled server error | Express default response; may be HTML and may include a stack outside production |
| `503` | `/health` when MongoDB is not connected | `{ status:"degraded", ... }` |

There is no custom error middleware and no machine-readable error code. Client
code matches on `message` in a few places; do not change messages casually.

---

## 8. Client Consumption

- `frontend/js/auth.js` resolves the HTTP base as `''` in production (same
  origin, Vercel rewrites) and `http://localhost:3000` when running on a
  non-3000 localhost port (Vite).
- Every authenticated frontend request uses `credentials: 'include'` and adds
  `Authorization: Bearer <localStorage auth_token>` when present.
- `frontend/js/sharing.js` and `geofencing.js` use the same base and auth
  helper. The share viewer (`initViewer`) calls the public GET without auth and
  then opens a share socket.
- Errors are shown through `showToast(message, type)`. There is no global fetch
  interceptor or automatic retry.
- The socket URL is `VITE_SOCKET_URL || VITE_API_BASE ||` local backend in dev
  or `window.location.origin` in production (`frontend/js/socket.js`). In the
  current production deployment `VITE_API_BASE` points at the backend origin,
  so Socket.IO connects directly.
