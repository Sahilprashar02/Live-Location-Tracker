# Backend Deployment — Live Location Tracker

Backend-only production deployment on the Oracle Cloud server, using the shared
infrastructure from the `Infra` repo. The **frontend is not part of this
deployment** (it is hosted separately on Vercel).

> Source of truth: `Dockerfile`, `docker-compose.prod.yml`, `scripts/deploy.sh`,
> `scripts/server-setup.sh`, `/opt/apps/infra/*`.

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

- **Public hostname:** `llt.140-245-27-200.sslip.io` (Let's Encrypt cert).
- The backend container publishes **no host port**; global-nginx proxies to it
  over `platform-network`.
- Socket.IO (polling → websocket) is proxied by `nginx/conf.d/llt.conf` with
  the `Upgrade` headers and long read timeouts.

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
    └── scripts/{deploy.sh,server-setup.sh}
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
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth credentials |

Register this exact redirect URI in Google Cloud Console:

```
https://llt.140-245-27-200.sslip.io/auth/google/callback
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
```

CI: `.github/workflows/deploy.yml` (currently **manual only** — `workflow_dispatch`).
It rsyncs `backend/`, `docker-compose.prod.yml` and `scripts/` to the server,
then runs `scripts/deploy.sh`. To enable auto-deploy, uncomment the `push`
trigger in that file. Requires repo secrets `SERVER_HOST` and `SSH_PRIVATE_KEY`.

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

- Add the Google OAuth redirect URI above.
- Rebuild the Vercel frontend with `VITE_API_BASE=https://llt.140-245-27-200.sslip.io`
  (the frontend currently targets `window.location.origin`).
- Switch the CI workflow from manual to push-triggered once validated.

---

## 9. Rollback

```bash
# rebuild from the previous commit on the server
cd /opt/apps/live-location-tracker
git checkout <previous-commit>   # or re-sync the previous backend/ via CI
./scripts/deploy.sh
```

Images are tagged `llt-backend:latest`; `deploy.sh` prunes only dangling images.
