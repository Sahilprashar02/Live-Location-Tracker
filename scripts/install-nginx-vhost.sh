#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# Install or check the Live Location Tracker nginx vhost
# ═══════════════════════════════════════════════════════════════════════════════
#
# The vhost lives in the shared nginx config directory, outside this repository.
# A reviewable copy is tracked at deploy/nginx/llt.conf.
#
# Default: compare the tracked copy with the installed file and run nginx -t.
# --apply: install the tracked copy, test it, and reload nginx only if valid.
#          Requires CONFIRM=yes because global-nginx serves other projects.
#
# Server usage (from the app root):
#   ./scripts/install-nginx-vhost.sh --check
#   CONFIRM=yes ./scripts/install-nginx-vhost.sh --apply
#
# Environment overrides:
#   NGINX_CONF_DIR   default /opt/apps/infra/nginx/conf.d
#   NGINX_CONTAINER  default global-nginx
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
SOURCE="$APP_DIR/deploy/nginx/llt.conf"
TARGET_DIR="${NGINX_CONF_DIR:-/opt/apps/infra/nginx/conf.d}"
TARGET="$TARGET_DIR/llt.conf"
CONTAINER="${NGINX_CONTAINER:-global-nginx}"
MODE="check"

usage() {
    cat <<'EOF'
Usage: scripts/install-nginx-vhost.sh [--check|--apply]

  --check   Compare the tracked vhost with the installed copy and run nginx -t
            (default; makes no changes)
  --apply   Install the tracked vhost, run nginx -t, and reload nginx only if
            the config is valid. Requires CONFIRM=yes.
  --help    Show this message

Environment:
  NGINX_CONF_DIR   Installed vhost directory
                   (default: /opt/apps/infra/nginx/conf.d)
  NGINX_CONTAINER  nginx container name (default: global-nginx)
  CONFIRM          Must be "yes" for --apply
EOF
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --check) MODE="check" ;;
        --apply) MODE="apply" ;;
        -h|--help) usage; exit 0 ;;
        *)
            echo "Unknown option: $1" >&2
            usage >&2
            exit 2
            ;;
    esac
    shift
done

if [ ! -f "$SOURCE" ]; then
    echo "Tracked vhost not found: $SOURCE" >&2
    exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
    echo "docker is required." >&2
    exit 1
fi

if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
    echo "nginx container not found: $CONTAINER" >&2
    exit 1
fi

echo "Tracked:  $SOURCE"
echo "Installed: $TARGET"
echo "Container: $CONTAINER"

SAME=0
if [ -f "$TARGET" ]; then
    if cmp -s "$SOURCE" "$TARGET"; then
        echo "Status: installed vhost matches the tracked copy."
        SAME=1
    else
        echo "Status: installed vhost differs from the tracked copy."
        diff -u "$TARGET" "$SOURCE" || true
    fi
else
    echo "Status: vhost is not installed."
fi

if [ "$MODE" = "check" ]; then
    docker exec "$CONTAINER" nginx -t
    if [ "$SAME" -eq 1 ]; then
        echo "check=ok"
    else
        echo "check=drift"
    fi
    exit 0
fi

if [ "$SAME" -eq 1 ]; then
    docker exec "$CONTAINER" nginx -t
    echo "No change; nginx was not reloaded."
    exit 0
fi

if [ "${CONFIRM:-}" != "yes" ]; then
    echo "Refusing to modify shared nginx without CONFIRM=yes." >&2
    echo "Run: CONFIRM=yes $0 --apply" >&2
    exit 2
fi

BACKUP=""
if [ -f "$TARGET" ]; then
    BACKUP="$(mktemp /tmp/llt-nginx.XXXXXX)"
    cp "$TARGET" "$BACKUP"
fi

TMP="${TARGET}.tmp.$$"
cleanup_tmp() {
    rm -f "$TMP"
}
trap cleanup_tmp EXIT

install -m 0644 "$SOURCE" "$TMP"
mv "$TMP" "$TARGET"

if ! docker exec "$CONTAINER" nginx -t; then
    echo "Candidate vhost failed nginx -t; restoring the previous config." >&2
    if [ -n "$BACKUP" ]; then
        cp "$BACKUP" "$TARGET"
    else
        rm -f "$TARGET"
    fi
    docker exec "$CONTAINER" nginx -t || true
    rm -f "$BACKUP"
    exit 1
fi

if ! docker exec "$CONTAINER" nginx -s reload; then
    echo "nginx reload failed; restoring the previous config." >&2
    if [ -n "$BACKUP" ]; then
        cp "$BACKUP" "$TARGET"
    else
        rm -f "$TARGET"
    fi
    docker exec "$CONTAINER" nginx -t || true
    rm -f "$BACKUP"
    exit 1
fi

rm -f "$BACKUP"
echo "Applied and reloaded $CONTAINER."
