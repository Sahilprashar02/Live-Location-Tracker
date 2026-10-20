# Backend Deployment — Live Location Tracker

Backend-only production deployment on the Oracle Cloud server, using the shared
infrastructure from the `Infra` repo. The **frontend is not part of this
deployment** (it is hosted separately on Vercel).

> Source of truth: `Dockerfile`, `docker-compose.prod.yml`, `scripts/deploy.sh`,
> `scripts/install-nginx-vhost.sh`, `deploy/nginx/llt.conf`,
> `scripts/server-setup.sh`, `/opt/apps/infra/*`.
>
> This is the original detailed runbook. The documentation index, security
> notes, and troubleshooting live in [`docs/`](docs/README.md); see
> [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the same topology with the
> verification checklist and rollback caveats.

---

## 1. Architecture

```
Browser / Vercel frontend
        │  HTTPS
        ▼
global-nginx            (shared, Infra)          :443
        │  platform-network
        ▼
llt-backend             (this project)           :5000 (no host port)
        ├──► global-mongodb   db=location_tracker      (shared, Infra)
        └──► global-kafka     bootstrap global-kafka:9092 (shared, Infra)
```

- **Public backend hostname:** `llt.140-245-27-200.sslip.io` (TLS managed by the
  shared `global-certbot`). The browser does not use it for normal API calls:
  Vercel rewrites `/auth/*` and `/api/*` to the backend
  (`frontend/vercel.json`), so the address bar stays on
  `https://live-location-tracker-jade.vercel.app`. Socket.IO cannot be proxied
  by Vercel rewrites, so it connects directly to the backend host configured in
  `VITE_SOCKET_URL` (or `VITE_API_BASE`).
- The backend container publishes **no host port**; global-nginx proxies to it
  over `platform-network`.
- Socket.IO (polling → websocket) is proxied by `nginx/conf.d/llt.conf` with
  the `Upgrade` headers and long read timeouts. A reviewable copy is tracked at
  `deploy/nginx/llt.conf`; `scripts/install-nginx-vhost.sh --check` compares it
  with the installed file, while `CONFIRM=yes ... --apply` is the only path
  that writes to shared nginx.

---

## 2. Shared infra vs project services

| Component | Owner | Name | Notes |
|---|---|---|---|
| Reverse proxy + TLS | Infra | `global-nginx` | also serves other projects |
| Database | Infra | `global-mongodb` | DB `location_tracker`, user `location_tracker_user` |
| Message broker | Infra | `global-kafka` | single-node KRaft, **internal only** |
| Certbot | Infra | `global-certbot` | auto-renews certs |
| Backend app | **this project** | `llt-backend` | image `llt-backend:latest` |

Networks: `platform-network` (external, shared).
Volumes: `global-kafka-data`, `global-mongodb-data` (shared). The app has no
stateful volume of its own.

---

## 3. Server layout

```
/opt/apps/
├── infra/                     shared: nginx, mongodb, redis, postgres, kafka, certbot
│   ├── docker-compose.yml
│   └── nginx/conf.d/llt.conf
└── live-location-tracker/     this project
    ├── .env                   secrets (NOT in git)
    ├── .env.production.example
    ├── docker-compose.prod.yml
    ├── backend/               app source + Dockerfile
    ├── deploy/nginx/llt.conf  tracked copy for review/install
    └── scripts/{deploy.sh,install-nginx-vhost.sh,server-setup.sh}
```

---

## 4. Environment

`.env` lives at `/opt/apps/live-location-tracker/.env` (mode 600) and is
**never** committed or overwritten by deploys. Variable names (see
`.env.production.example`):

| Variable | Value |
|---|---|
| `PORT` | `5000` |
| `NODE_ENV` | `production` |
| `CLIENT_URL` | `https://live-location-tracker-jade.vercel.app` |
| `MONGODB_URI` | `mongodb://location_tracker_user:****@global-mongodb:27017/location_tracker?authSource=location_tracker` |
| `KAFKA_BROKER` | `global-kafka:9092` |
| `SESSION_SECRET` | random (`openssl rand -hex 32`) |
| `GOOGLE_CALLBACK_URL` | `https://live-location-tracker-jade.vercel.app/auth/google/callback` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth credentials |

Register this exact redirect URI in Google Cloud Console (it stays on the
Vercel domain; the `/auth/*` rewrite proxies it to the backend):

```
https://live-location-tracker-jade.vercel.app/auth/google/callback
```

---

## 5. Kafka (shared)

The broker is defined once in `Infra/docker-compose.yml` and reused by every
project. It publishes **no host ports**; clients connect at `global-kafka:9092`.
The app creates its topic (`location-updates`) on startup via the Kafka admin API.

```bash
# start / inspect (does not touch other services)
cd /opt/apps/infra
docker compose up -d kafka
docker exec global-kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --list
docker exec global-kafka /opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server localhost:9092 --list
```

---

## 6. Deploy

First-time only (server):

```bash
cd /opt/apps/live-location-tracker
./scripts/server-setup.sh location_tracker_user '<strong-url-safe-password>'
# then fill .env (SESSION_SECRET, GOOGLE_CLIENT_ID/SECRET, MONGODB_URI password)
```

Every deploy:

```bash
cd /opt/apps/live-location-tracker
./scripts/deploy.sh          # build → up -d --force-recreate → health poll

# Shared nginx vhost: compare first; apply only with explicit authorization.
./scripts/install-nginx-vhost.sh --check
# CONFIRM=yes ./scripts/install-nginx-vhost.sh --apply
```

CI: `.github/workflows/deploy.yml` deploys automatically on pushes to `main`
that touch `backend/**`, `scripts/**`, `deploy/**`, `docker-compose.prod.yml`,
or the workflow itself. It can also be run manually (`workflow_dispatch`). It
rsyncs `backend/`, `docker-compose.prod.yml`, `scripts/`, and the tracked
`deploy/` config to the server, then runs `scripts/deploy.sh`. The nginx vhost
is not installed or reloaded by CI. Requires repo secrets:

- `SERVER_HOST` — the bare IP/hostname `140.245.27.200` (not the local SSH
  alias `oracle`, and no `ubuntu@` prefix).
- `SSH_PRIVATE_KEY` — the private key file contents (not the `.pub`).

---

## 7. Operations

```bash
cd /opt/apps/live-location-tracker
docker compose -f docker-compose.prod.yml ps            # status
docker compose -f docker-compose.prod.yml logs -f backend # logs
docker compose -f docker-compose.prod.yml restart backend # restart
docker compose -f docker-compose.prod.yml stop backend    # stop
docker compose -f docker-compose.prod.yml up -d backend   # start
docker exec llt-backend wget -qO- http://localhost:5000/health
curl -fsS https://llt.140-245-27-200.sslip.io/health
```

`/health` returns **200** only when MongoDB is connected, otherwise **503**.

Do **not** run `docker compose down -v`, `docker volume prune`, or any command
that removes volumes — shared databases and Kafka data live in volumes.

---

## 8. Manual / out-of-scope steps

- Add the Google OAuth redirect URI above and set `GOOGLE_CALLBACK_URL` in
  the server `.env`.
- Vercel project (frontend) env: keep
  `VITE_API_BASE=https://llt.140-245-27-200.sslip.io` (used for Socket.IO) or
  set `VITE_SOCKET_URL` explicitly. HTTP calls are same-origin and use
  `frontend/vercel.json` rewrites; no other frontend env is required.
- CI is push-triggered and validated (run `39367923258`).

---

## 9. Rollback

There is no blue/green deploy and images are built as `llt-backend:latest`.
Rollback means redeploying the previous commit:

```bash
# Preferred: revert the bad commit on main and let CI redeploy.
git revert <bad-commit>
git push origin main
```

Only if the server directory is a git checkout **and has no local changes**,
you can check out the previous commit there instead:

```bash
cd /opt/apps/live-location-tracker
git status --short          # must be empty
git checkout <previous-commit>
./scripts/deploy.sh
```

`deploy.sh` prunes only dangling images; it never removes volumes. If the
release changed a schema or index, read `docs/DATABASE.md` §8 first — there is
no migration framework, so a code rollback may not match data already written
by the newer code.
