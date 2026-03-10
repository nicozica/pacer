#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOST="${1:-pizero}"
REMOTE_CURRENT_DIR="${REMOTE_CURRENT_DIR:-/srv/apps/pacer/current}"

if [[ "$HOST" == "-h" || "$HOST" == "--help" ]]; then
  echo "Usage: $0 [host]"
  echo "Env: REMOTE_CURRENT_DIR=/srv/apps/pacer/current"
  exit 0
fi

rsync -az --delete "$ROOT_DIR/web/" "$HOST:$REMOTE_CURRENT_DIR/web/"

echo "Frontend synced to $HOST:$REMOTE_CURRENT_DIR/web"
echo "No service restart is required for static-only changes."
