# Live Location Tracker — Environment

> Every variable, whether it is public, and what breaks without it.
> Filled from the code and deployment files on 2026-10-20.

---

## 1. How Configuration Works

### Backend

1. `backend/src/server.js` calls `require('dotenv').config()` before importing
   anything else. `dotenv` reads `.env` from `process.cwd()` — `backend/.env`
   when you run `cd backend && npm start`.
2. `dotenv` does **not** override existing environment variables. In Docker,
   `docker-compose.prod.yml` injects `env_file: .env` from the app root and then
   sets `NODE_ENV=production` and `PORT=5000` in `environment:`. Compose's
   values win.
3. `validateEnv()` runs before the Express app is created. It exits the process
   if any of `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`,
   `MONGODB_URI`, `KAFKA_BROKER`, or `PORT` is missing.
4. The server file is `/opt/apps/live-location-tracker/.env` on the production
   host, mode `600`. It is never committed, copied into the image, or rsynced
   by the deploy workflow.
5. Local development can either run the backend from `backend/` (serving the
   static frontend on `:3000`) or run Vite on `:5173` and set `CLIENT_URL` so
   CORS allows the Vite origin.

### Frontend

- Vite loads `frontend/.env` (ignored by git) and any `.env.[mode]` files at
  **build time**. Only `VITE_*` variables are exposed to the browser.
- Vercel supplies production `VITE_*` values through the project's environment
  settings. Changing one requires a new build; restarting the backend does not
  affect it.
- `frontend/.env` currently defines `VITE_API_BASE` only. `VITE_SOCKET_URL` is
  read but not defined locally.
- No `VITE_*` value is a secret. They are embedded in the shipped JavaScript.

The production server `.env` is deliberately not reproduced here. The example
files contain placeholders.

---

## 2. Variables

| Variable | Purpose | Required | Default | Exposure |
|---|---|---|---|---|
| `GOOGLE_CLIENT_ID` | Google OAuth client id | **Yes** — startup exits if missing | None | Server |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | **Yes** — startup exits if missing | None | Server — **secret** |
| `GOOGLE_CALLBACK_URL` | Exact OAuth callback URL; production points at the Vercel domain so the callback is proxied | No | `/auth/google/callback` (relative to the backend) | Server |
| `SESSION_SECRET` | Signs the Express session **and** the JWT | **Yes** — startup exits if missing | None | Server — **secret** |
| `MONGODB_URI` | MongoDB connection string, including credentials and `authSource` | **Yes** — startup exits if missing | None | Server — **secret** |
| `KAFKA_BROKER` | Kafka bootstrap broker | **Yes** — startup exits if missing | None in production; code fallback `localhost:9092` | Server |
| `KAFKA_CA_CERT` | PEM CA certificate for TLS Kafka | No | None | Server — **secret-ish** |
| `KAFKA_ACCESS_CERT` | PEM client certificate for mutual TLS | No | None | Server — **secret** |
| `KAFKA_ACCESS_KEY` | PEM client private key for mutual TLS | No | None | Server — **secret** |
| `KAFKA_USERNAME` | SASL/PLAIN username (used only if certs are absent) | No | None | Server |
| `KAFKA_PASSWORD` | SASL/PLAIN password | No | None | Server — **secret** |
| `PORT` | HTTP port the Node process listens on | **Yes** per `validateEnv`; code also defaults to `3000` | `3000` in code, `5000` in production compose | Server |
| `NODE_ENV` | Express/runtime mode; production compose sets it | No | None in code; `production` in compose | Server |
| `CLIENT_URL` | Exact frontend origin for CORS, socket CORS, and post-login/logout redirects | **No in code, but required for the deployed cross-origin setup** | None (CORS middleware is not mounted; redirect is relative) | Server (the URL itself is public) |
| `SERVE_FRONTEND` | Set to the string `false` to disable static frontend serving | No | Auto: serve only if `frontend/index.html` exists | Server |
| `VITE_API_BASE` | Public backend origin; used as the socket URL fallback and historically for HTTP | No in code; set in Vercel/local `.env` for a working socket | None → socket falls back to `window.location.origin` | **Public** |
| `VITE_SOCKET_URL` | Explicit Socket.IO origin; overrides `VITE_API_BASE` | No | None | **Public** |

The `KAFKA_CA_CERT` / `KAFKA_ACCESS_CERT` / `KAFKA_ACCESS_KEY` path takes
precedence when all three are present. Otherwise, `KAFKA_USERNAME` +
`KAFKA_PASSWORD` enables SASL/PLAIN with TLS. If neither set is present, the
client connects without TLS/SASL. Production uses the shared plaintext broker
inside `platform-network`, so none of these are set there.

---

## 3. Public Variables

> Anything prefixed with `VITE_` is **shipped to every browser**. Never put a
> secret in one.

| Variable | Shipped to the browser | Value |
|---|---|---|
| `VITE_API_BASE` | Yes | Backend origin used for Socket.IO (not a secret) |
| `VITE_SOCKET_URL` | Yes | Optional explicit Socket.IO origin (not a secret) |

`VITE_API_BASE` is currently set to the backend origin in Vercel. HTTP calls
no longer use it; `frontend/js/auth.js` uses same-origin rewrites in production.
Socket.IO cannot use a Vercel rewrite, so it still needs a direct backend URL.

---

## 4. Server-Only Variables

These must never be exposed to the browser or committed:

`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`,
`SESSION_SECRET`, `MONGODB_URI`, `KAFKA_BROKER`, `KAFKA_CA_CERT`,
`KAFKA_ACCESS_CERT`, `KAFKA_ACCESS_KEY`, `KAFKA_USERNAME`, `KAFKA_PASSWORD`,
`PORT`, `NODE_ENV`, `CLIENT_URL`, `SERVE_FRONTEND`.

`GOOGLE_CLIENT_ID` and `CLIENT_URL` are not secrets in the same sense as a
client secret or database password, but they are server configuration and
should stay out of client bundles unless a feature explicitly needs them.

---

## 5. Dead or Unused Variables

No declared variable is completely dead. The following are conditional or
currently unused in the normal production path:

| Variable | Why it is unused / conditional |
|---|---|
| `KAFKA_CA_CERT`, `KAFKA_ACCESS_CERT`, `KAFKA_ACCESS_KEY` | Only used when all three are set; production uses a plaintext in-network broker |
| `KAFKA_USERNAME`, `KAFKA_PASSWORD` | Only used when the cert triple is absent; production does not use SASL |
| `SERVE_FRONTEND` | Not set in production; the backend-only image has no `frontend/index.html`, so static serving is already off |
| `VITE_SOCKET_URL` | Not set in the current local `frontend/.env`; the code falls back to `VITE_API_BASE` |
| `NODE_ENV` | Not read explicitly by application code; Express and libraries use it. Production compose sets it |

Do not copy a conditional variable into production “just in case” — an empty or
placeholder value changes the connection path.

---

## 6. Variables Without an Example File

`CLIENT_URL`, `GOOGLE_CALLBACK_URL`, `SERVE_FRONTEND`, and the optional Kafka
TLS/SASL variables are now documented in `backend/.env.example` and
`.env.production.example`.

The only variables without an example file are the public frontend ones:

| Variable | What breaks | Failure mode |
|---|---|---|
| `VITE_SOCKET_URL` | The socket falls back to `VITE_API_BASE`; if that is also absent, it uses `window.location.origin` | Socket.IO tries the Vercel origin, which cannot proxy WebSockets → live updates fail |
| `VITE_API_BASE` | Same as above in production | Live updates fail; HTTP still works via rewrites |

Add a `frontend/.env.example` if the frontend gains more build-time variables.
Until then, configure these in Vercel and in the ignored local
`frontend/.env`.

`CLIENT_URL` and `GOOGLE_CALLBACK_URL` are the two most common causes of a
production login that “works locally” but fails on Vercel.

---

## 7. Adding a Variable

1. Add it to this document with purpose, required/default, and exposure.
2. Add it to **both** example files:
   - `backend/.env.example` for backend/local variables
   - `.env.production.example` for production variables
3. If it is public (`VITE_*`), add it to the Vercel project environment and
   rebuild the frontend. Never put a secret in a `VITE_*` value.
4. If it is server-only, add it to the server `.env` (mode `600`) and restart
   the backend. Do not print the value in logs or docs.
5. If it has a safe default, make the code use the default rather than crashing.
6. If it changes CORS, cookies, proxy trust, or auth, read
   [SECURITY.md](./SECURITY.md) and get a review first.
7. Update [DEPLOYMENT.md](./DEPLOYMENT.md) if it changes the release procedure.
