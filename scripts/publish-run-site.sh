#!/usr/bin/env bash

set -Eeuo pipefail

PACER_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_REPO="${RUN_REPO:-$PACER_REPO/../run-nico-ar}"
RUN_SITE_DEPLOY_TARGET="${RUN_SITE_DEPLOY_TARGET:-pizero:/srv/data/www/run.nico.ar/}"
RUN_SITE_DEPLOY_HOST="${RUN_SITE_DEPLOY_HOST:-${RUN_SITE_DEPLOY_TARGET%%:*}}"
RUN_SITE_DEPLOY_REMOTE_DIR="${RUN_SITE_DEPLOY_REMOTE_DIR:-${RUN_SITE_DEPLOY_TARGET#*:}}"
RUN_SITE_PUBLIC_URL="${RUN_SITE_PUBLIC_URL:-https://run.nico.ar}"
RUN_SITE_DEPLOY_LOCK="${RUN_SITE_DEPLOY_LOCK:-$PACER_REPO/storage/locks/run-site-publish.lock}"
RUN_SITE_DEPLOY_LOG_DIR="${RUN_SITE_DEPLOY_LOG_DIR:-$PACER_REPO/storage/logs/run-site-publish}"

mkdir -p "$(dirname "$RUN_SITE_DEPLOY_LOCK")" "$RUN_SITE_DEPLOY_LOG_DIR"

exec 9>"$RUN_SITE_DEPLOY_LOCK"
if ! flock -n 9; then
  echo "PACER_PUBLISH_LOCKED=1"
  echo "Another run site deploy is already running."
  exit 75
fi

timestamp="$(date '+%Y%m%d-%H%M%S')"
log_file="$RUN_SITE_DEPLOY_LOG_DIR/$timestamp.log"
touch "$log_file"
ln -sfn "$(basename "$log_file")" "$RUN_SITE_DEPLOY_LOG_DIR/latest.log"

echo "PACER_PUBLISH_LOG_FILE=$log_file"

exec > >(tee -a "$log_file") 2>&1

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting run-nico-ar publish."
echo "Run repo: $RUN_REPO"
echo "Deploy target: $RUN_SITE_DEPLOY_TARGET"
echo "Public URL: $RUN_SITE_PUBLIC_URL"
echo "PACER_PUBLISH_DEPLOY_TARGET=$RUN_SITE_DEPLOY_TARGET"

if [[ ! -d "$RUN_REPO" ]]; then
  echo "Run site repo not found: $RUN_REPO"
  exit 1
fi

cd "$RUN_REPO"

if [[ ! -d node_modules ]]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Installing public site dependencies..."
  npm install
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Building public site..."
npm run build
echo "PACER_PUBLISH_BUILD_OK=1"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Syncing dist/ to target..."
rsync -avz --delete dist/ "$RUN_SITE_DEPLOY_TARGET"
echo "PACER_PUBLISH_DEPLOY_OK=1"

derive_latest_session_slug() {
  node - "$PACER_REPO/storage/json/cms/latest-session.json" <<'NODE'
const fs = require('node:fs');

const filePath = process.argv[2];
const snapshot = JSON.parse(fs.readFileSync(filePath, 'utf8'));

function normalizeSessionTypeTitle(value) {
  return String(value ?? '').trim();
}

function isGenericStravaTitle(title) {
  const normalized = String(title ?? '').trim();
  if (!normalized) return true;

  return /^(morning|evening|lunch|afternoon|night|midday)\s+run$/i.test(normalized)
    || /^run$/i.test(normalized);
}

function selectEditorialSessionTitle(sourceTitle, sessionType) {
  const normalizedTitle = String(sourceTitle ?? '').trim();
  const normalizedSessionType = normalizeSessionTypeTitle(sessionType);

  if (normalizedTitle && !isGenericStravaTitle(normalizedTitle)) {
    return normalizedTitle;
  }

  if (normalizedSessionType) {
    return normalizedSessionType;
  }

  return normalizedTitle || 'Run';
}

function slugifySegment(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

const title = selectEditorialSessionTitle(snapshot.title, snapshot.manual?.sessionType);
const slug = `${snapshot.sessionDate}-${slugifySegment(title) || 'session'}`;

process.stdout.write(slug);
NODE
}

verify_origin_deploy() {
  local expected_session_path="$1"
  local remote_root="${RUN_SITE_DEPLOY_REMOTE_DIR%/}"
  local remote_session_file="${remote_root}${expected_session_path}index.html"
  local remote_home_file="${remote_root}/index.html"

  if ! ssh "$RUN_SITE_DEPLOY_HOST" "test -f '$remote_session_file'"; then
    echo "Origin verification failed: missing $remote_session_file"
    return 1
  fi

  if ! ssh "$RUN_SITE_DEPLOY_HOST" "grep -Fq '$expected_session_path' '$remote_home_file'"; then
    echo "Origin verification failed: homepage does not reference $expected_session_path"
    return 1
  fi

  return 0
}

verify_public_site() {
  local expected_session_path="$1"
  local public_root="${RUN_SITE_PUBLIC_URL%/}"
  local public_session_url="${public_root}${expected_session_path}"
  local public_home_url="${public_root}/"
  local session_html=""
  local home_html=""

  session_html="$(curl -fsSL --max-time 20 -H 'Cache-Control: no-cache' -H 'Pragma: no-cache' "$public_session_url")" || {
    echo "Public verification failed: could not fetch $public_session_url"
    return 1
  }

  if [[ -z "$session_html" ]]; then
    echo "Public verification failed: empty response from $public_session_url"
    return 1
  fi

  home_html="$(curl -fsSL --max-time 20 -H 'Cache-Control: no-cache' -H 'Pragma: no-cache' "$public_home_url")" || {
    echo "Public verification failed: could not fetch $public_home_url"
    return 1
  }

  if ! grep -Fq "$expected_session_path" <<<"$home_html"; then
    echo "Public verification failed: homepage does not reference $expected_session_path"
    return 1
  fi

  return 0
}

expected_session_slug="$(derive_latest_session_slug)"
expected_session_path="/sessions/${expected_session_slug}/"

echo "Expected latest session path: $expected_session_path"
echo "PACER_PUBLISH_EXPECTED_SESSION_PATH=$expected_session_path"
echo "PACER_PUBLISH_PUBLIC_URL=$RUN_SITE_PUBLIC_URL"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Verifying origin deploy..."
origin_verified=0
if verify_origin_deploy "$expected_session_path"; then
  origin_verified=1
  echo "PACER_PUBLISH_VERIFY_ORIGIN_OK=1"
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Verifying public visibility..."
public_verified=0
if verify_public_site "$expected_session_path"; then
  public_verified=1
  echo "PACER_PUBLISH_VERIFY_PUBLIC_OK=1"
fi

if [[ "$public_verified" -eq 1 ]]; then
  if [[ "$origin_verified" -eq 1 ]]; then
    echo "PACER_PUBLISH_VERIFY_OK=1"
  else
    echo "PACER_PUBLISH_ORIGIN_INCONCLUSIVE=1"
  fi
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Publish complete."
  exit 0
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Publish verification failed."
exit 1
