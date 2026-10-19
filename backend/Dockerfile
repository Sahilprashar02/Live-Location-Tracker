# ── Live Location Tracker Backend — Production Dockerfile ────────────────────
# Backend-only image. The frontend is hosted separately (Vercel) and is NOT
# part of this image.
#
# Single Node process on purpose: Socket.IO keeps live-socket state in memory,
# so the app must not run as a PM2 cluster or multiple replicas without a
# Socket.IO Redis adapter + sticky sessions.
#
# ARM64 compatible (Oracle Cloud Ampere A1).
# ─────────────────────────────────────────────────────────────────────────────

FROM node:22-alpine

# wget is required for the compose healthcheck (wget http://localhost:5000/health).
# ca-certificates keeps outbound TLS (Google OAuth, etc.) working.
RUN apk add --no-cache wget ca-certificates \
    && addgroup -g 1001 -S appgroup \
    && adduser -S appuser -u 1001 -G appgroup

WORKDIR /app

# Deterministic installs — respect the lockfile, never upgrade versions.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# Application source only (see .dockerignore).
COPY src/ ./src/

RUN chown -R appuser:appgroup /app

USER appuser

EXPOSE 5000

ENV NODE_ENV=production

# Runtime config comes from the compose env_file (.env on the server).
# dotenv never overrides existing env vars, so compose values win.
CMD ["node", "src/server.js"]
