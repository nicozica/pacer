# Pacer

Personal running workflow assistant.
Reads training activities from Intervals.icu, stores curated sessions in SQLite, and exports local CMS snapshots for run.nico.ar.
Playwright browser capture is available as a secondary, optional tool.

## Requirements

- Node.js 18+ (uses built-in `fetch`)
- Chromium — only needed for browser capture (`npx playwright install chromium`)

## Setup

```bash
npm install
cp .env.example .env
# Edit .env and fill in your Intervals.icu API credentials
```

## Session storage

Pacer now stores curated sessions in SQLite under `storage/db/pacer.sqlite` by default.

Use:

```bash
npm run sessions:seed
```

to insert the first two real sessions and refresh local export snapshots under `storage/json/cms/`.

---

## Training Data Source

Pacer fetches live training activities from Intervals.icu. Personal API key auth uses Basic Auth with username `API_KEY` and the API key as the password.

Configure `.env`:

```env
TRAINING_SOURCE=intervals
INTERVALS_API_KEY=your_intervals_api_key
INTERVALS_ATHLETE_ID=0
INTERVALS_FETCH_DAYS=180
```

Fetch and save activities to `storage/json/activities.latest.json`:

```bash
npm run training:fetch
```

Run a safe Intervals.icu smoke test without publishing:

```bash
npm run intervals:smoke -- --oldest=2026-05-01 --newest=2026-06-02
npm run intervals:smoke -- --oldest=2026-05-01 --newest=2026-06-02 --write-raw
```

The optional raw response is written under `storage/json/debug/`, which is ignored by git.

---

## Browser capture (optional / secondary)

Playwright-based screenshot capture for pages that don't have an API.

### Setup

```bash
npx playwright install chromium
```

### Authenticate (browser session)

```bash
npm run auth:garmin   # saves to storage/auth/garmin.json
```

Opens Chromium in headed mode. Log in manually, then press Enter to save the session.
To run on a headless Pi, generate the session on a machine with a display and copy it:

```bash
scp /srv/repos/personal/argensonix/labs/pacer/storage/auth/garmin.json \
    rpi:/srv/repos/personal/argensonix/labs/pacer/storage/auth/garmin.json
```

### Capture screenshots

```bash
npm run capture
```

Screenshots are saved to `storage/screenshots/YYYY-MM-DD/`.

Debug in headed mode:

```bash
HEADLESS=false npm run capture
```

---

## Structure

```
src/
  training/     Training source adapters and fetch commands
  config/       App configuration (reads .env)
  capture/      Playwright screenshot runner (secondary)
  auth/         Playwright browser session scripts (secondary)
  utils/        Storage helpers

storage/
  auth/         Tokens and session state (gitignored)
  json/         Exported activity data
  screenshots/  Browser captures, organized by date
  logs/         Future: run logs
```

---

## Production deploy (Pipita)

For a release-based rsync workflow (`dist/` artifact, `current` symlink, rollback, and external secrets/storage),
see:

`docs/pipita-production-flow.md`
