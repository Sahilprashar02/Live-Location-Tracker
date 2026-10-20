# Live Location Tracker — Documentation

> The index and reading order. Everything else hangs off this file.
> Installed from the `docs-scaffold` template and filled from the code on
> 2026-10-20.

Real-time location sharing with live tracking, friends, share links, and geofence alerts.

Unless a section says otherwise, statements here are **VERIFIED** by reading the
implementation. Inferences are marked **INFERRED**; unmeasured or unconfirmed
facts are **UNKNOWN**.

---

## 1. Start Here

| I want to… | Read |
|---|---|
| **Understand the product** | [PRD.md](./PRD.md) |
| **Understand the code** | [ARCHITECTURE.md](./ARCHITECTURE.md) |
| **Write code that fits** | [CODE_STYLE.md](./CODE_STYLE.md) |
| **Work on auth or security** | [SECURITY.md](./SECURITY.md) |
| **Verify my change** | [TESTING.md](./TESTING.md) |
| **Debug something** | [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) |

---

## 2. The Documents

| Document | What it covers |
|---|---|
| [AGENTS.md](../AGENTS.md) | **Mandatory rules for AI coding agents** |
| [PRD.md](./PRD.md) | What the product is and who it is for |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Where the code lives and why |
| [DATABASE.md](./DATABASE.md) | Models, fields, indexes, relationships |
| [API.md](./API.md) | Every endpoint, with auth and validation |
| [SECURITY.md](./SECURITY.md) | Controls, gaps, secrets handling |
| [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) | Tokens, primitives, layout rules |
| [CODE_STYLE.md](./CODE_STYLE.md) | Conventions and anti-patterns |
| [TESTING.md](./TESTING.md) | How to verify a change |
| [UX_FLOWS.md](./UX_FLOWS.md) | End-to-end user journeys |
| [ENVIRONMENT.md](./ENVIRONMENT.md) | Every env var, public vs server-only |
| [INTEGRATIONS.md](./INTEGRATIONS.md) | Third-party services and failure modes |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | How it ships and how to roll back |
| [PERFORMANCE.md](./PERFORMANCE.md) | Measured baseline and scaling triggers |
| [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) | Symptom-driven diagnostics |
| [CHANGELOG.md](./CHANGELOG.md) | What changed and when |

---

## 3. Status Markers

| Marker | Meaning |
|---|---|
| **VERIFIED** | Read in the code, or observed against the running system, during this documentation pass |
| **INFERRED** | Reasonable conclusion, not directly confirmed |
| **UNKNOWN** | Not established — do not guess |
| **PROPOSED** | Planned, does not exist yet |

`INFERRED` and `PROPOSED` are never presented as existing behaviour.

---

## 4. How This Was Filled In

This documentation was installed with `docs-scaffold/bootstrap.sh` and then
filled from the actual source under `backend/src/` and `frontend/js/`, plus the
live deployment on 2026-10-20.

The following were read in full or in the relevant parts:

- every backend route, model, middleware, consumer, socket handler, and config
  module
- the frontend entry point and each page module (`auth`, `socket`, `map`,
  `search`, `directions`, `tools`, `sharing`, `geofencing`)
- `Dockerfile`, both compose files, the deploy workflow, deploy scripts, and
  both example environment files
- the live backend `/health`, `/auth/me`, and share-link responses, and the
  Vercel page and rewrite responses

An unfilled placeholder is honest; an invented claim is a defect. No owner
placeholders remain.

---

## 5. Rules for This Repository

1. **Code is authoritative.** If a document disagrees with the code, the code
   is right. Record the conflict here, then fix the document.
2. **Never invent.** No fabricated endpoints, metrics, users, or testimonials.
3. **Update docs in the same change** as the behaviour.
4. **Do not weaken security** to make a task easier.
5. **No automated tests exist.** Do not claim a check passed unless you ran it.

Full rules: [../AGENTS.md](../AGENTS.md)

---

## 6. Known Inconsistencies Between Docs and Code

**No known conflicts as of 2026-10-20.** The root [README.md](../README.md) was
reconciled with the implementation: Esri basemaps, Oracle Cloud + shared
MongoDB/Kafka, Node 22, the public OSRM call sites, the actual env variables,
and no unsupported scale claim.

If a document later disagrees with the code, the code is authoritative. Record
the conflict here, then fix the document.

---

## 7. Outstanding Risks

| # | Risk | Status |
|---|---|---|
| 1 | No automated tests, linter, or type checker; CI deploys without a test gate | VERIFIED |
| 2 | Socket.IO state (active users, rate limits, consumer dedup cache) is in process memory; the app is intentionally a single Node process | VERIFIED |
| 3 | JWTs cannot be revoked; logout only removes the local copy and session cookie | VERIFIED |
| 4 | `ShareSession.allowedViewers` is written but never enforced by the public share endpoint or the share socket | VERIFIED |
| 5 | Private share codes are 5 random bytes (40 bits) and the public endpoint has no HTTP rate limit | VERIFIED / INFERRED |
| 6 | `npm audit` reports 10 backend vulnerabilities (including 1 critical) and frontend dev-tool advisories | VERIFIED |
| 7 | No CSP or `helmet`; `X-Powered-By: Express` is sent | VERIFIED |
| 8 | Public Nominatim/OSRM/tile services have no SLA and may rate-limit or fail | VERIFIED (no fallback) / UNKNOWN (limits) |
| 9 | Service worker caches same-origin API GETs cache-first with no `Authorization` in the cache key; logout does not clear it | VERIFIED |

Full detail: [SECURITY.md](./SECURITY.md) and [PERFORMANCE.md](./PERFORMANCE.md).

---

## 8. Related

| | |
|---|---|
| Live site | <https://live-location-tracker-jade.vercel.app> |
| Backend origin (not for browser navigation) | <https://llt.140-245-27-200.sslip.io> |
| Repository | <https://github.com/Sahilprashar02/Live-Location-Tracker> |
