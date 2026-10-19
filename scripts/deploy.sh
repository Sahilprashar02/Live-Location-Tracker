#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# Live Location Tracker — Production Deployment Script (backend only)
# ═══════════════════════════════════════════════════════════════════════════════
#
# Rebuilds and restarts ONLY the llt-backend container.
# Does NOT touch global infrastructure (nginx, mongodb, redis, kafka, certbot)
# or any other app (vantagehire, teambaithak).
#
# Usage:
#   ./scripts/deploy.sh
#
# Server path: /opt/apps/live-location-tracker/
#
# NEVER run destructive commands from here (down -v, volume prune, rm -rf).
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

T_DEPLOY_START=$(date +%s)
declare -A T_PHASE
phase_begin() { T_PHASE["$1_start"]=$(date +%s); }
phase_end() {
    local name="$1" now elapsed
    now=$(date +%s)
    elapsed=$(( now - ${T_PHASE["${name}_start"]} ))
    T_PHASE["$name"]=$elapsed
    echo "  ⏱  $name took ${elapsed}s"
}

# Resolve paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
cd "$APP_DIR"

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
COMPOSE=(docker compose -f "$COMPOSE_FILE")
CONTAINER="llt-backend"
SERVICE="backend"

echo "═══════════════════════════════════════════════"
echo " Live Location Tracker Deployment (backend only)"
echo " $(date '+%Y-%m-%d %H:%M:%S')"
echo " Path: $APP_DIR"
echo " Compose: $COMPOSE_FILE"
echo "═══════════════════════════════════════════════"

# ── Preflight ─────────────────────────────────────────────────────────────────
echo ""
echo "[0/5] Preflight checks..."
if [ ! -f ".env" ]; then
    echo "  ❌ .env not found at $APP_DIR/.env"
    echo "     cp .env.production.example .env  # then fill in real values"
    exit 1
fi
if ! docker network inspect platform-network >/dev/null 2>&1; then
    echo "  ❌ Docker network 'platform-network' is missing."
    echo "     Create once: docker network create platform-network"
    exit 1
fi
if ! docker inspect global-kafka >/dev/null 2>&1; then
    echo "  ⚠️  global-kafka container not found."
    echo "     Start the shared broker first: (cd /opt/apps/infra && docker compose up -d kafka)"
    echo "     Continuing — the app starts without Kafka and retries in the background."
fi
echo "  ✅ .env present, platform-network present"

# ── 1. Pull latest code (if inside a git repository) ──────────────────────────
if [ -d ".git" ]; then
    echo ""
    echo "[1/5] Pulling latest code from git..."
    git pull --ff-only
    echo "  ✅ Code updated"
else
    echo ""
    echo "[1/5] Code already synced (non-git mode)"
fi

# ── 2. Build new Docker image ─────────────────────────────────────────────────
echo ""
echo "[2/5] Building Docker image..."
phase_begin "docker-build"
export DOCKER_BUILDKIT=1 BUILDKIT_INLINE_CACHE=1 COMPOSE_DOCKER_CLI_BUILD=1
"${COMPOSE[@]}" build "$SERVICE"
phase_end "docker-build"
echo "  ✅ Image built"

# ── 3. Restart backend container ──────────────────────────────────────────────
echo ""
echo "[3/5] Updating container..."
phase_begin "container-restart"
"${COMPOSE[@]}" up -d --force-recreate "$SERVICE"
phase_end "container-restart"
echo "  ✅ Container started"

# ── 4. Wait for health check ──────────────────────────────────────────────────
# /health returns 200 only when MongoDB is connected, else 503.
echo ""
echo "[4/5] Waiting for health check..."
phase_begin "health-wait"
ATTEMPTS=0
MAX_ATTEMPTS=30

until docker inspect --format='{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null | grep -q "healthy"; do
    ATTEMPTS=$((ATTEMPTS + 1))
    if [ "$ATTEMPTS" -ge "$MAX_ATTEMPTS" ]; then
        echo ""
        echo "  ❌ Health check FAILED after ${MAX_ATTEMPTS} attempts ($(( MAX_ATTEMPTS * 5 ))s)"
        echo ""
        echo "  Recent logs:"
        "${COMPOSE[@]}" logs --tail=50 "$SERVICE"
        echo ""
        echo "  Troubleshoot:"
        echo "    docker compose -f $COMPOSE_FILE logs -f $SERVICE"
        echo "    docker exec $CONTAINER wget -qO- http://localhost:5000/health"
        exit 1
    fi
    printf "  Waiting... (%d/%d)\r" "$ATTEMPTS" "$MAX_ATTEMPTS"
    sleep 5
done
phase_end "health-wait"
echo "  ✅ Health check passed                    "

# ── 5. Show status ────────────────────────────────────────────────────────────
echo ""
echo "[5/5] Status:"
echo ""
"${COMPOSE[@]}" ps
echo ""

# Clean up dangling images only — never volumes (DB data lives there).
DANGLING=$(docker images -q --filter "dangling=true" 2>/dev/null | wc -l)
if [ "$DANGLING" -gt 0 ]; then
    echo "  🗑  Cleaning ${DANGLING} dangling image(s)..."
    docker image prune -f > /dev/null 2>&1
fi

echo "═══════════════════════════════════════════════"
echo " ✅ Live Location Tracker backend deployed successfully"
echo " ⏱  Total: $(( $(date +%s) - T_DEPLOY_START ))s (build: ${T_PHASE[docker-build]:-?}s, restart: ${T_PHASE[container-restart]:-?}s, health: ${T_PHASE[health-wait]:-?}s)"
echo "═══════════════════════════════════════════════"
