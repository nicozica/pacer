#!/usr/bin/env bash
set -euo pipefail

HOST="${1:-pizero}"
TARGET_RELEASE="${2:-}"
REMOTE_APP_DIR="${REMOTE_APP_DIR:-/srv/apps/pacer}"
SERVICE_NAME="${SERVICE_NAME:-pacer}"
SYSTEMCTL_PREFIX="${SYSTEMCTL_PREFIX:-sudo}"
HEALTHCHECK_URL="${HEALTHCHECK_URL:-http://127.0.0.1:8787/api/healthz}"

if [[ "$HOST" == "-h" || "$HOST" == "--help" ]]; then
  echo "Usage: $0 [host] <release-timestamp-or-absolute-path>"
  echo "Env: REMOTE_APP_DIR=/srv/apps/pacer SERVICE_NAME=pacer SYSTEMCTL_PREFIX=sudo HEALTHCHECK_URL=http://127.0.0.1:8787/api/healthz"
  exit 0
fi

if [[ -z "$TARGET_RELEASE" ]]; then
  echo "Usage: $0 <host> <release-timestamp-or-absolute-path>"
  echo "Available releases on $HOST:"
  ssh "$HOST" "ls -1 '$REMOTE_APP_DIR/releases' | sort"
  exit 1
fi

if [[ "$TARGET_RELEASE" = /* ]]; then
  REMOTE_TARGET_DIR="$TARGET_RELEASE"
else
  REMOTE_TARGET_DIR="$REMOTE_APP_DIR/releases/$TARGET_RELEASE"
fi

ssh "$HOST" "test -d '$REMOTE_TARGET_DIR'"
ssh "$HOST" "ln -sfn '$REMOTE_TARGET_DIR' '$REMOTE_APP_DIR/current'"

if [[ -n "$SYSTEMCTL_PREFIX" ]]; then
  ssh "$HOST" "$SYSTEMCTL_PREFIX systemctl restart '$SERVICE_NAME'"
else
  ssh "$HOST" "systemctl restart '$SERVICE_NAME'"
fi

ssh "$HOST" "curl -fsS '$HEALTHCHECK_URL' >/dev/null"

echo "Rollback applied: $REMOTE_TARGET_DIR"
