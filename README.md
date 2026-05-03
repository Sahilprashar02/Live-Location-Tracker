# Live Location Tracker

Authenticated users share live browser geolocation through Socket.IO. The backend publishes every valid location event to Kafka, a socket consumer broadcasts those events to connected users, and a separate database processor consumes the same topic to store location history as JSONL.

## Tech Stack

- React + Vite
- Leaflet + React Leaflet
- Node.js + Express
- Socket.IO
- KafkaJS + Kafka
- OIDC / OAuth 2.0 Authorization Code flow

## Setup

```bash
cp .env.example .env
npm install
docker compose up -d kafka
npm run dev
```

In another terminal, run the database processor:

```bash
npm run db-processor
```

Open `http://localhost:5173`.

## Environment Variables

See `.env.example`. For local development, `DEMO_AUTH=true` provides a demo login so the socket/auth/map/Kafka flow can be tested without creating an external OIDC app. For a real OIDC provider, set `DEMO_AUTH=false` and configure:

- `OIDC_ISSUER_URL`
- `OIDC_CLIENT_ID`
- `OIDC_CLIENT_SECRET`
- `OIDC_REDIRECT_URI`
- `OIDC_SCOPES`

The OIDC app callback URL should be `http://localhost:4000/auth/callback` in local development.

## OIDC Auth Setup

1. Create an OAuth/OIDC application in Auth0, Okta, Keycloak, or another provider.
2. Enable Authorization Code flow.
3. Add `http://localhost:4000/auth/callback` as an allowed callback URL.
4. Add `http://localhost:5173` and `http://localhost:4000` as allowed origins where required.
5. Copy the issuer discovery URL and client credentials into `.env`.

The backend stores the logged-in user in the server session. Socket.IO reuses that same session, so location events are tied to `user.id`, not only to a socket id.

## Socket Event Flow

1. User logs in.
2. Browser asks for location permission.
3. Client emits `location:update` every `VITE_LOCATION_INTERVAL_MS`.
4. Server validates latitude, longitude, accuracy, timestamp, and event id.
5. Server rejects unauthenticated, invalid, stale, or duplicate events.
6. Server publishes the event to Kafka.

## Kafka Event Flow

Topic: `location-updates`

- Producer: Socket server publishes valid location updates.
- Consumer group `socket-broadcaster`: receives Kafka events and broadcasts `location:updated` to connected browsers.
- Consumer group `location-history-writer`: receives the same events independently and stores/simulates location history.

Kafka is intentionally in the live path. This mirrors rider/customer tracking systems where high-frequency movement events are streamed first, then independent consumers update sockets, analytics, alerting, and persistence without making the socket handler do every job synchronously.

## Database Processor

Run:

```bash
npm run db-processor
```

It writes newline-delimited JSON to `server/data/location-history.jsonl`. In production, this process would batch writes to Postgres, TimescaleDB, Cassandra, ClickHouse, or object storage. Writing directly to a database on every socket event can become expensive because location streams are bursty and high-volume; batching and consumer groups keep the socket server responsive.

## Demo Video Link

Add your YouTube unlisted demo link here before submission:

`https://youtube.com/watch?v=YOUR_VIDEO_ID`

## Submission Links

- Public GitHub repository: add link here
- Live deployed link: optional
- YouTube unlisted demo: add link here

## Assumptions And Limitations

- Demo auth is available for local testing, but real submission should explain the configured OIDC provider.
- Browser geolocation requires HTTPS in production or localhost in development.
- Location history is stored as JSONL for a simple demo; production storage should use batching, retention policies, and geospatial indexes.
- Stale users are removed from maps after `STALE_USER_MS`.
- Duplicate event ids are ignored in memory; production dedupe should use a bounded cache such as Redis.
