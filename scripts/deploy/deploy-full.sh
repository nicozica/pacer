#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOST="${1:-pizero}"
REMOTE_APP_DIR="${REMOTE_APP_DIR:-/srv/apps/pacer}"
SERVICE_NAME="${SERVICE_NAME:-pacer}"
SYSTEMCTL_PREFIX="${SYSTEMCTL_PREFIX:-sudo}"
HEALTHCHECK_URL="${HEALTHCHECK_URL:-http://127.0.0.1:8787/api/healthz}"
TIMESTAMP="$(date +%Y%m%d%H%M%S)"
LOCAL_ARTIFACT_DIR="$ROOT_DIR/.deploy/artifact-$TIMESTAMP"
REMOTE_RELEASE_DIR="$REMOTE_APP_DIR/releases/$TIMESTAMP"

if [[ "$HOST" == "-h" || "$HOST" == "--help" ]]; then
  echo "Usage: $0 [host]"
  echo "Env: REMOTE_APP_DIR=/srv/apps/pacer SERVICE_NAME=pacer SYSTEMCTL_PREFIX=sudo HEALTHCHECK_URL=http://127.0.0.1:8787/api/healthz"
  exit 0
fi

"$ROOT_DIR/scripts/deploy/build-artifact.sh" "$LOCAL_ARTIFACT_DIR"

ssh "$HOST" "mkdir -p '$REMOTE_APP_DIR/releases' '$REMOTE_APP_DIR/shared' '/srv/data/pacer/storage' '/srv/secrets/pacer'"

rsync -az --delete "$LOCAL_ARTIFACT_DIR/" "$HOST:$REMOTE_RELEASE_DIR/"

ssh "$HOST" "cd '$REMOTE_RELEASE_DIR' && npm ci --omit=dev --ignore-scripts"
ssh "$HOST" "ln -sfn '$REMOTE_RELEASE_DIR' '$REMOTE_APP_DIR/current'"

if [[ -n "$SYSTEMCTL_PREFIX" ]]; then
  ssh "$HOST" "$SYSTEMCTL_PREFIX systemctl restart '$SERVICE_NAME'"
else
  ssh "$HOST" "systemctl restart '$SERVICE_NAME'"
fi

ssh "$HOST" "curl -fsS '$HEALTHCHECK_URL' >/dev/null"

echo "Deployed release: $REMOTE_RELEASE_DIR"
