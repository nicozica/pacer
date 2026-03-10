# Pacer production flow for Pipita

This document defines a lightweight release workflow for running Pacer on Raspberry Pi Zero 2 W.

## Target layout

```text
/srv/apps/pacer/
  releases/<timestamp>/
  current -> /srv/apps/pacer/releases/<timestamp>

/srv/data/pacer/storage/
/srv/secrets/pacer/.env
```

## Runtime assumptions

- Build is produced before deploy (`dist/` generated from TypeScript).
- Runtime uses Node directly (`node dist/web/server.js`).
- Health endpoint is available at `GET /api/healthz`.
- Secrets and storage are outside the release tree.
- Deploy transport is `rsync`.

## First-time setup on Pipita

```bash
ssh pizero "sudo mkdir -p /srv/apps/pacer/releases /srv/data/pacer/storage /srv/secrets/pacer"
ssh pizero "sudo chown -R pacer:pacer /srv/apps/pacer /srv/data/pacer /srv/secrets/pacer"
scp .env.production pizero:/tmp/pacer.env
ssh pizero "sudo mv /tmp/pacer.env /srv/secrets/pacer/.env && sudo chown pacer:pacer /srv/secrets/pacer/.env && sudo chmod 600 /srv/secrets/pacer/.env"
scp deploy/pacer.service.example pizero:/tmp/pacer.service
ssh pizero "sudo mv /tmp/pacer.service /etc/systemd/system/pacer.service"
ssh pizero "sudo systemctl daemon-reload && sudo systemctl enable pacer"
```

Example `/srv/secrets/pacer/.env` values:

```env
WEB_HOST=0.0.0.0
WEB_PORT=8787
STORAGE_DIR=/srv/data/pacer/storage
STRAVA_TOKENS_FILE=/srv/data/pacer/storage/auth/strava-tokens.json
STRAVA_CLIENT_ID=...
STRAVA_CLIENT_SECRET=...
STRAVA_REDIRECT_URI=http://localhost/exchange_token
STRAVA_ACTIVITIES_PER_PAGE=20
WEATHER_DEFAULT_LAT=
WEATHER_DEFAULT_LON=
```

## Deploy flows

### Frontend-only deploy

Use when only files under `web/` changed.

```bash
scripts/deploy/deploy-frontend.sh pizero
```

No restart is needed for static-only updates.

### Full/backend deploy

Use when `src/`, `package.json`, runtime behavior, or dependencies changed.

```bash
scripts/deploy/deploy-full.sh pizero
```

This script:
1. Builds TypeScript locally.
2. Creates a timestamped artifact.
3. Rsyncs artifact into `/srv/apps/pacer/releases/<timestamp>/`.
4. Installs runtime dependencies with `npm ci --omit=dev` on Pipita.
5. Switches `current` symlink.
6. Restarts `pacer` service.
7. Runs a health check.

## Rollback

```bash
scripts/deploy/rollback.sh pizero <timestamp>
```

Or provide an absolute release path as second argument.

## Health checks

```bash
ssh pizero "systemctl status pacer --no-pager -l"
ssh pizero "journalctl -u pacer -n 120 --no-pager"
ssh pizero "curl -fsS http://127.0.0.1:8787/api/healthz"
ssh pizero "curl -fsS http://127.0.0.1:8787/api/latest | jq '.fetchedAt'"
```
