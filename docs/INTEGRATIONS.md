# Live Location Tracker — Integrations

> Third-party services, their contracts, and what happens when they fail.
> Filled from the call sites on 2026-10-20.

---

## 1. Integration Index

| Service | Purpose | Auth | Critical? |
|---|---|---|---|
| Google OAuth 2.0 | Sign-in and profile | OAuth client id/secret | **Yes** — no login without it |
| MongoDB (`global-mongodb`) | All persistent state | Connection-string credentials | **Yes** — app exits at startup if down; health 503 later |
| Kafka (`global-kafka`) | Location event bus | None in-network (plaintext) | **Partial** — HTTP/socket stay up; live fan-out and history stop |
| nginx (`global-nginx`) | TLS and reverse proxy | None (network boundary) | **Yes** for the backend origin |
| Vercel | Static frontend, `/auth` + `/api` rewrites | Vercel account | **Yes** for the browser app |
| Esri ArcGIS tiles | Dark, Light, Satellite basemaps | None (keyless) | No — map can switch layers |
| OpenStreetMap tiles | Standard basemap | None | No |
| OpenTopoMap | Terrain basemap | None | No |
| Nominatim | Forward/reverse geocoding and POIs | None (public policy) | No for the core live map; yes for search |
| OSRM | Driving/walking/cycling routes | None (public demo/foot/bike servers) | No |
| Open-Meteo | Weather widget | None | No — hidden on failure |
| `ui-avatars.com` | Fallback avatars | None | No |
| Google Fonts | Inter typeface | None | No |
| unpkg | Leaflet 1.9.4 CSS/JS | None | **Yes** for the map |
| cdn.socket.io | Socket.IO client 4.7.5 | None | **Yes** for live updates |
| cdnjs | qrcodejs 1.0.0 | None | No — QR is optional |

“Critical” means the core live-sharing journey is broken without it, not that
the whole site is unavailable.

---

## 2. Google OAuth 2.0

| Aspect | Detail |
|---|---|
| Purpose | Identify the user and obtain `displayName`, `email`, and `avatar` |
| Protocol | OAuth 2.0 authorization-code flow via `passport-google-oauth20` 2.0.0 |
| Auth | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| Callback | `GOOGLE_CALLBACK_URL` in production; relative `/auth/google/callback` otherwise |
| Scopes | `profile`, `email` only |
| Failure behaviour | Passport `failureRedirect` to `CLIENT_URL/?error=auth_failed`; a strategy exception can become a default 500 |
| Tested? | Redirect URI accepted and the Google consent page loads. A full account sign-in was **not** exercised end to end during this pass. |

The strategy creates a `User` on first sign-in and updates `lastSeen` on later
sign-ins. There is no refresh token, no offline access, and no token storage
for Google API calls.

Production registers this exact URI in Google Console:

```text
https://live-location-tracker-jade.vercel.app/auth/google/callback
```

It stays on the Vercel domain; `frontend/vercel.json` proxies `/auth/*` to the
backend. The old backend-origin callback URI is not needed.

OAuth `state` is **not** enabled (the strategy is constructed without
`state: true`). See [SECURITY.md](./SECURITY.md) §9.

---

## 3. MongoDB (`global-mongodb`)

| Aspect | Detail |
|---|---|
| Purpose | Users, friends, geofences, share sessions, location history, and Express sessions |
| Protocol | MongoDB wire protocol via Mongoose 8.23.1 |
| Auth | Credentials in `MONGODB_URI`, `authSource=location_tracker` in production |
| Env vars | `MONGODB_URI` (required) |
| Failure behaviour | Startup `connectDB()` exits the process on failure; after startup, `/health` returns 503 and most routes fail; the server logs `disconnected`/`error` events |
| Tested? | Live `/health` reports `connected`, `readyState: 1` |

The production and local database names differ (`location_tracker` vs
`location-tracker` in the example). The container is `mongo:7` with a 4 GiB
memory limit, shared by other projects. There is no per-app database container.

`connect-mongo` writes sessions into the same database. A Mongo outage affects
both application data and sessions; the JWT path may still authenticate until
its expiry, but middleware that needs a session store may fail first.

---

## 4. Kafka (`global-kafka`)

| Aspect | Detail |
|---|---|
| Purpose | Decouple location ingest from fan-out and batched persistence |
| Protocol | Kafka protocol via `kafkajs` 2.2.4 |
| Auth | None in production: plaintext on `platform-network` |
| Env vars | `KAFKA_BROKER` (required); optional TLS/SASL variables in `backend/src/config/kafka.js` |
| Topic | `location-updates`, **1 partition**, replication factor 1, auto-created if absent |
| Consumer groups | `broadcast-group`, `db-processor-group` |
| Retry | KafkaJS `initialRetryTime: 1000`, `retries: 10` |
| Failure behaviour | The HTTP server still starts; `initKafka()` is backgrounded. `send-location` fails with `error-message` until the producer reconnects. No broadcasts or history writes. The socket handler is still initialised for basic connectivity. |
| Tested? | The container is running; the app's Kafka init is verified by code, not by an end-to-end location event in this pass |

The broker is a shared `apache/kafka:3.9.1` container with a 2 GiB memory
limit, internal address `global-kafka:9092`, and no host port. It is managed by
the Infra compose, not `docker-compose.prod.yml`.

The topic is created with `numPartitions: 1` for compatibility. Events are
keyed by `userId`, so per-user order is preserved. Increasing partitions would
not break key ordering but changes consumer parallelism and must be reviewed.

The broadcast consumer keeps a 10,000-entry in-memory dedup cache. The DB
consumer buffers 50 events or 5 seconds and uses `insertMany` with the unique
`eventId` to make retries idempotent.

---

## 5. nginx (`global-nginx`)

| Aspect | Detail |
|---|---|
| Purpose | Terminate TLS for `llt.140-245-27-200.sslip.io` and proxy HTTP/WebSocket to `llt-backend:5000` |
| Protocol | HTTP/1.1, HTTPS, WebSocket upgrade |
| Auth | None; the network path is the control |
| Config | Shared Infra config (`/opt/apps/infra/nginx/conf.d/llt.conf` on the server) |
| Failure behaviour | The backend is unreachable from the browser; Vercel HTTP rewrites and Socket.IO both fail |
| Tested? | Live HTTPS requests return 200/401/404 as expected; nginx adds security headers |

The backend container publishes **no host port**. nginx is the only public path
to it. The backend sets `trust proxy` to `1`, assuming one trusted proxy.

The nginx response includes `X-Frame-Options: SAMEORIGIN`,
`X-Content-Type-Options: nosniff` (twice), `X-XSS-Protection`, and
`Referrer-Policy`. It does not add HSTS to the backend response.

---

## 6. Vercel

| Aspect | Detail |
|---|---|
| Purpose | Host the static Vite build and proxy `/auth/*` and `/api/*` to the backend |
| Protocol | HTTPS + Vercel rewrites |
| Auth | Vercel account/project integration |
| Config | `frontend/vercel.json`, plus `VITE_API_BASE` in the Vercel project environment |
| Failure behaviour | The frontend is unavailable; the backend origin remains directly reachable |
| Tested? | Live root, `/track/test`, `/auth/me`, and `/api/share/...` return the expected statuses; HSTS and `no-store` headers observed |

Rewrites:

```json
{ "source": "/auth/:path*", "destination": "https://llt.140-245-27-200.sslip.io/auth/:path*" }
{ "source": "/api/:path*",  "destination": "https://llt.140-245-27-200.sslip.io/api/:path*" }
{ "source": "/(.*)",        "destination": "/index.html" }
```

The SPA fallback is why `/track/<code>` returns the app. `Cache-Control:
no-store` is added to `/auth/*` and `/api/*`. That header controls browser and
CDN caches, but **not** the service worker's Cache API; the worker currently
stores same-origin GET responses anyway. See
[SECURITY.md](./SECURITY.md) §9.

Vercel cannot proxy the WebSocket upgrade, so Socket.IO uses
`VITE_API_BASE`/`VITE_SOCKET_URL` and connects directly to the backend origin.
That host is visible in the browser network panel (not in the address bar).

---

## 7. Map Tiles

| Provider | Layers | Auth | Notes |
|---|---|---|---|
| Esri ArcGIS | World Dark Gray Canvas, World Light Gray Canvas, World Imagery | None | Dark/Light use `maxNativeZoom: 16` and upscale to `maxZoom: 19`; satellite `maxZoom: 18` |
| OpenStreetMap | Standard | None | `{s}.tile.openstreetmap.org`, subdomains `abc`, `maxZoom: 19` |
| OpenTopoMap | Terrain | None | `{s}.tile.opentopomap.org`, `maxZoom: 17`, CC-BY-SA |

The CSS hides Leaflet's attribution control:

```css
.leaflet-control-attribution { display: none !important; }
```

OSM, Esri, and OpenTopoMap require attribution in their terms. Hiding it is a
**compliance gap**; do not copy this pattern to a new map. See
[SECURITY.md](./SECURITY.md) §9 and the integration notes.

Tile failures leave blank/grey tiles. There is no fallback provider or
user-facing tile error.

---

## 8. Nominatim (OpenStreetMap)

| Aspect | Detail |
|---|---|
| Purpose | Forward search, reverse geocoding, nearby POIs |
| Protocol | HTTPS JSON (`https://nominatim.openstreetmap.org`) |
| Auth | None; public usage policy |
| Parameters | `format=json`, `limit` 6 for search / 25 for POIs, `viewbox` from current bounds, `countrycodes=in` for search and POIs |
| Failure behaviour | Empty result list or an escaped error message in the results panel; no fallback provider |
| Tested? | Not exercised in this pass |

`frontend/js/search.js` debounces typing by 350 ms, stores up to 8 recent
searches in `llt_recent_searches`, and restricts results to India
(`countrycodes=in`). POI searches also set `bounded=1` and a `viewbox` from the
current map bounds. The code attempts a `User-Agent: LiveLocationTracker/1.0`
header, but browsers do not allow callers to set `User-Agent`; the effective
header is the browser's. There is no explicit client-side request queue; the
public Nominatim policy’s rate limits are **UNKNOWN** for this usage pattern.
`directions.js` has its own Nominatim search and reverse calls for route inputs.

Search is restricted to India (`countrycodes=in`), which is a product
constraint visible in the code. POIs are also restricted to India.

---

## 9. OSRM

| Profile | Base URL |
|---|---|
| Driving | `https://router.project-osrm.org` |
| Walking | `https://routing.openstreetmap.de/routed-foot` |
| Cycling | `https://routing.openstreetmap.de/routed-bike` |

| Aspect | Detail |
|---|---|
| Purpose | Route geometry, distance/duration, and step instructions |
| Protocol | HTTPS JSON OSRM route API |
| Auth | None |
| Failure behaviour | Route request fails; the UI shows an error/loading state and retains the map; no fallback router |
| Tested? | Not exercised in this pass |

Auto-reroute: when the route origin is “Your location”, the module watches GPS
and recalculates after the user moves more than **15 metres**. The public demo
servers are not a guaranteed production service; quotas and availability are
**UNKNOWN**.

Directions also has a geocode fallback that strips building/house prefixes and
common road suffixes (`rd`, `road`, `st`, `street`) before retrying Nominatim.
It is a heuristic, not a guaranteed match.

---

## 10. Open-Meteo

| Aspect | Detail |
|---|---|
| Purpose | Current temperature/weather code beside the username |
| Protocol | HTTPS JSON: `https://api.open-meteo.com/v1/forecast?latitude=...&longitude=...&current_weather=true` |
| Auth | None |
| Cache | 5 minutes in the browser (`WEATHER_CACHE_MS`) |
| Failure behaviour | `console.warn`; the widget stays hidden; no user-facing error |
| Tested? | Not exercised in this pass |

Open-Meteo is optional; the live map and sharing work without it.

---

## 11. Avatars, Fonts, and CDNs

| Service | Use | Failure behaviour |
|---|---|---|
| `ui-avatars.com` | Fallback avatar when the Google avatar is empty or fails | Broken image; the `onerror` fallback points to the same service |
| Google Fonts | Inter 300–800 | Falls back to the system sans-serif stack |
| `unpkg.com/leaflet@1.9.4` | Leaflet CSS/JS | No map; core app broken |
| `cdn.socket.io/4.7.5` | Socket.IO browser client | `io` undefined; live socket connection fails |
| `cdnjs.cloudflare.com/.../qrcodejs/1.0.0` | Share QR rendering | Share link still works; QR area stays empty |

None of the CDN `<script>` tags use Subresource Integrity (`integrity`). The
Leaflet tags have `crossorigin` but no hash. This is a supply-chain risk; see
[SECURITY.md](./SECURITY.md) §9.

---

## 12. Resilience

| Failure | Detection | Response | User sees |
|---|---|---|---|
| Google OAuth unavailable | Google error/redirect | `failureRedirect` | Login screen / `auth_failed` |
| MongoDB down at startup | `connectDB()` rejects | `process.exit(1)` | Container unhealthy; deploy fails |
| MongoDB down after startup | Mongoose events; `/health` | 503; routes error | “Not authenticated”/generic errors; live socket auth may fail |
| Kafka down | `initKafka()` rejects | Log + socket handler still starts | “Failed to process location”; no live updates/history |
| Kafka consumer lag | No metric | Events queue in Kafka | Delayed updates; no alerting |
| nginx down | External probe | — | Frontend cannot reach API/socket |
| Vercel down | External probe | — | Frontend unavailable |
| Tile provider down | Leaflet tile errors | Switch layer manually | Blank tiles |
| Nominatim down/limited | Non-OK response | Escaped error text | No search/POI/reverse results |
| OSRM down | Non-OK response | Error text/toast | No route |
| Open-Meteo down | Fetch rejection | `console.warn` | Weather hidden |
| ui-avatars down | Image error | Same URL fallback | Broken avatar |
| CDN down | Script load failure | No fallback | Map/socket/QR missing |

There are no retries with backoff for the browser’s third-party fetches, no
circuit breakers, and no health metric for Kafka consumer lag. KafkaJS itself
retries producer/consumer connections (10 attempts, 1 s initial delay).

---

## 13. Cost and Quotas

| Service | Free tier | Paid trigger | Current limit |
|---|---|---|---|
| Google OAuth | Standard OAuth quotas (not measured) | Google Cloud billing/quota | **UNKNOWN** |
| Esri tiles | Keyless public services; terms apply | Esri account/plan | **UNKNOWN** |
| OSM/OpenTopoMap tiles | Public community servers | Self-hosting/paid provider | **UNKNOWN**; usage policy applies |
| Nominatim | Public service | Self-host/paid provider | **UNKNOWN**; public policy applies |
| OSRM demo/foot/bike | Public demo servers | Self-host/paid provider | **UNKNOWN**; not a guaranteed service |
| Open-Meteo | Free API tier | Commercial/paid plan | **UNKNOWN** |
| Vercel | Project plan (not recorded) | Plan limits | **UNKNOWN** |
| Oracle Cloud | Shared server capacity | Upgrade | 4 vCPU / 23 GiB host, shared; `llt-backend` capped at 1 GiB |
| `ui-avatars.com` | Free | — | **UNKNOWN** |

Do not invent quotas. If a provider silently caps, the symptom is usually a
mysterious 4xx/429 or missing tiles, not an application error.

---

## 14. Webhooks

**None.** Google OAuth uses a browser redirect, not a webhook. There are no
incoming signed webhooks, so there is no signature-verification or idempotency
path to document.

---

## 15. Adding an Integration

1. Is it necessary? What does it replace? Could an existing dependency cover it?
2. Can the feature work without it? If not, what is the fallback?
3. Which env vars are needed, and are they all in
   [ENVIRONMENT.md](./ENVIRONMENT.md) and the example files?
4. What is the timeout, and what happens when it is hit?
5. Is it retried? Is the retry idempotent? For real writes, deduplicate.
6. Does it need a key? Keep it server-side; never put it in a `VITE_*` value.
7. Does it add a CDN script? Prefer a pinned version with SRI, or vendor it.
8. Does it change attribution/licensing? Update the map/layer UI if so.
9. Record the failure mode and the user-visible fallback in this document.
