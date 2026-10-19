#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# Live Location Tracker — One-Time Server Setup (run ONCE on Oracle, manually)
# ═══════════════════════════════════════════════════════════════════════════════
#
# Run this on the server from /opt/apps/live-location-tracker/ BEFORE the first
# deploy (deploy.sh fails its preflight without .env).
#
# Usage:
#   ./scripts/server-setup.sh location_tracker_user '<strong-password>'
#
# What it does (idempotent, non-destructive — safe to re-run):
#   1. Verifies the shared `platform-network` exists (creates it if missing).
#   2. Creates the MongoDB user via the global Infra script
#      (skips if the user already exists).
#   3. Creates .env from .env.production.example if missing, then STOPS
#      so you can fill in real values before deploying.
#
# It does NOT start Kafka — that is shared infrastructure and is started from
# /opt/apps/infra with: docker compose up -d kafka
#
# NEVER touches global containers, other apps, or any existing .env file.
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

DB_NAME="${DB_NAME:-location_tracker}"
DB_USER="${1:-location_tracker_user}"
DB_PASS="${2:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
cd "$APP_DIR"

if [ -z "$DB_PASS" ]; then
    echo "Usage: $0 <db_user> '<db_password>'"
    echo ""
    echo "Example:"
    echo "  $0 location_tracker_user 'MyStrongPassword!'"
    echo ""
    echo "Or via env: DB_NAME=location_tracker $0 location_tracker_user 'pass'"
    exit 1
fi

echo "═══════════════════════════════════════════════"
echo " Live Location Tracker One-Time Server Setup"
echo " App dir: $APP_DIR"
echo " Database: $DB_NAME / user: $DB_USER"
echo "═══════════════════════════════════════════════"

# ── 1. Shared Docker network (created once for the whole server) ───────────────
echo ""
echo "[1/3] Checking platform-network..."
if docker network inspect platform-network >/dev/null 2>&1; then
    echo "  ✅ platform-network exists"
else
    echo "  Creating platform-network..."
    docker network create platform-network
    echo "  ✅ platform-network created"
fi

# ── 2. MongoDB user (via global Infra script; skips if user exists) ───────────
echo ""
echo "[2/3] Creating MongoDB user '${DB_USER}' on '${DB_NAME}'..."
if [ -x /opt/apps/infra/scripts/add-app-mongo-user.sh ]; then
    if /opt/apps/infra/scripts/add-app-mongo-user.sh "$DB_NAME" "$DB_USER" "$DB_PASS"; then
        echo "  ✅ MongoDB user ready"
    else
        echo "  ⚠️  add-app-mongo-user.sh exited non-zero."
        echo "     If the user already exists, this is expected — continuing."
        echo "     Otherwise create it manually:"
        echo "       /opt/apps/infra/scripts/add-app-mongo-user.sh $DB_NAME $DB_USER '<password>'"
    fi
else
    echo "  ❌ /opt/apps/infra/scripts/add-app-mongo-user.sh not found."
    echo "     Create the user manually (see Infra README: Adding a New Project)"
    echo "     and re-run this script."
    exit 1
fi

# ── 3. .env (create from template if missing; never overwrite) ────────────────
echo ""
echo "[3/3] Checking .env..."
if [ -f ".env" ]; then
    echo "  ✅ .env already exists — leaving it untouched"
else
    if [ -f ".env.production.example" ]; then
        cp .env.production.example .env
        echo "  ✅ Created .env from .env.production.example"
    else
        echo "  ❌ .env.production.example not found in $APP_DIR"
        exit 1
    fi
    echo ""
    echo "  ⛔ STOP: fill in real values in $APP_DIR/.env first:"
    echo "     MONGODB_URI (with the password from step 2), SESSION_SECRET,"
    echo "     GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, CLIENT_URL"
    echo ""
    echo "  Make sure the shared broker is running (from /opt/apps/infra):"
    echo "     docker compose up -d kafka"
    echo ""
    echo "  Then deploy: ./scripts/deploy.sh"
    exit 0
fi

echo ""
echo "═══════════════════════════════════════════════"
echo " ✅ Server setup complete — ready to deploy:"
echo "    ./scripts/deploy.sh"
echo "═══════════════════════════════════════════════"
