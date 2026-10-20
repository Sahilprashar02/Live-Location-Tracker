# Live Location Tracker — Product Requirements

> What this product is, who it is for, and what it deliberately is not.
> Filled from the implementation on 2026-10-20.

---

## 1. Problem

Sharing a live position with a small group usually means sending a static pin,
reading coordinates aloud, or installing a heavyweight app. The pin goes stale
immediately, there is no shared map, and there is no simple way to stop sharing
when the trip ends.

Live Location Tracker keeps a consented, browser-based position on a shared map,
shows accepted friends moving in near real time, and lets a user issue a
time-limited link that a recipient can open without an account.

---

## 2. Who It Is For

| Audience | What they need |
|---|---|
| **Primary — individuals coordinating in the moment** (friends, family, small groups) | See each other on one map, share a live position for a trip or meetup, and stop sharing afterwards. **INFERRED** from the feature set; no user research is recorded in the repository. |
| **Secondary — developers/operators evaluating the stack** | A working example of Google OAuth, Socket.IO, Kafka decoupling, batched MongoDB writes, and a Vercel + self-hosted backend deployment. **INFERRED** from the README and architecture. |
| **Recipients of a share link** | Open a link or QR code and watch one person's live position without creating an account. **VERIFIED** in `frontend/js/sharing.js` and `GET /api/share/:code`. |

No personas, testimonials, or user counts are recorded. Do not invent them.

---

## 3. What It Does

| Capability | Problem it solves |
|---|---|
| Google sign-in (`/auth/google`) | Gives each participant a stable identity without building a password system. |
| Live map of self and accepted friends | Replaces stale pins with a moving, shared view. |
| Browser geolocation tracking with a 5-second client send interval | Keeps positions current without draining the battery on every GPS tick. |
| Private share links and QR codes (`/track/:code`) | Lets someone watch a trip without installing anything or creating an account. |
| Share expiry (`1h`, `8h`, `forever`) and manual stop | Makes consent time-bounded and reversible. |
| Friend requests by email, accept/remove | Limits who receives live coordinates. |
| Geofence alerts (enter/exit/both) for accepted friends | Notifies the owner when a friend arrives at or leaves an area. |
| Place search, reverse geocoding, nearby POIs | Finds destinations and context on the map. |
| OSRM driving/walking/cycling directions with auto-reroute | Gets the user to a destination and recalculates when they move off course. |
| Distance/area measurement, drop pin, fullscreen | Small map utilities that avoid a separate tool. |
| Live weather for the user's coordinates (5-minute cache) | Adds local context without another app. |
| PWA manifest and service worker | Makes the browser app installable and keeps the shell available on a poor connection. |

---

## 4. Explicitly Not In Scope

The following are **not present in the current code**. Treat this as the
current boundary, not a promise that they will never be built.

| Not present | Why it is out of scope now |
|---|---|
| Native iOS/Android apps | The product is a browser app; the manifest provides an installable PWA instead. |
| Historical trip replay or analytics | `LocationHistory` has a 24-hour TTL and the UI only reads the latest point. |
| Voice turn-by-turn navigation | Directions draws a route and shows steps; there is no voice guidance. |
| Chat or in-app messaging | No message model, endpoint, or UI. |
| Payments, plans, or subscriptions | No billing code, plan gate, or pricing model. |
| Organisation/team tenancy or admin console | Every user is an individual Google account; there are no roles. |
| Location-spoof detection or anti-abuse review | Coordinates are range-validated only; a browser can report any in-range point. |
| End-to-end encryption of location data | The server and MongoDB read plaintext coordinates. |
| Account deletion, data export, or consent history | No endpoint or UI exists; only the 24-hour location TTL limits retention. |
| Offline maps or offline location updates | The service worker caches the app shell, map tiles, and some API GET responses, but not routing, websocket updates, or offline location capture. |

---

## 5. Core Journeys

| Journey | Summary | Detail |
|---|---|---|
| First visit and sign-in | Land on the login screen, authenticate with Google, receive a JWT, and enter the map. | [UX_FLOWS.md](./UX_FLOWS.md#2-first-visit-and-google-sign-in) |
| Start sharing and see friends | Grant geolocation, send positions, watch markers and the online list update. | [UX_FLOWS.md](./UX_FLOWS.md#3-start-sharing-and-watch-friends) |
| Create a share link | Choose a duration, copy the link/QR, and let a guest watch the owner. | [UX_FLOWS.md](./UX_FLOWS.md#4-create-and-open-a-share-link) |
| Add and accept a friend | Send a request by email; the recipient accepts; both can then receive positions and create geofences. | [UX_FLOWS.md](./UX_FLOWS.md#5-add-and-accept-a-friend) |
| Create a geofence alert | Pick an accepted friend, place a circle at the map centre, choose enter/exit/both. | [UX_FLOWS.md](./UX_FLOWS.md#6-create-a-geofence-alert) |
| Stop sharing / log out | End a link or log out; the map and socket are torn down. | [UX_FLOWS.md](./UX_FLOWS.md#7-stop-sharing-and-log-out) |

---

## 6. Success Criteria

**No product analytics or metrics pipeline exists in the repository.** There
are no dashboards, event trackers, or conversion numbers to report. Product
success is therefore **UNKNOWN** and must not be invented.

What can be verified operationally:

| Criterion | How it would be verified |
|---|---|
| The backend starts with a valid environment | `GET /health` returns `200` and `"database":{"status":"connected"}` |
| Google sign-in completes | A real Google account reaches the Vercel app with a JWT and `/auth/me` returns the user |
| A share link works end to end | A guest opens `/track/:code`, receives the latest point, and sees new socket updates |
| A live location round-trip works | A second signed-in browser receives the first browser's `location-update` |
| A geofence alert fires | Move a target across a fence boundary and observe `geofence-alert` in the owner's browser |
| The frontend deploys | Vercel builds and serves the app |

At the time of this documentation pass, `/health` and the public share endpoint
were verified live; the full Google sign-in and live round-trip were **not**
exercised end to end.

---

## 7. Open Questions

| # | Question | Blocking? |
|---|---|---|
| 1 | Should `allowedViewers` actually restrict share links, or should the field be removed? It is currently written but never enforced. | No, but it is a correctness/security gap. |
| 2 | Is a 40-bit share code plus no HTTP rate limit acceptable for public links? | No, but it needs a decision. |
| 3 | Should location history survive longer than 24 hours? The TTL currently deletes it. | No. |
| 4 | What is the expected concurrent-user target? It is not stated or measured anywhere. | No for local use; blocking for scaling claims. |
| 5 | Should logout revoke the JWT? It currently cannot. | No, but it limits incident response. |
| 6 | Should the product support account deletion and data export? No path exists today. | No. |
