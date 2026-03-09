# Pacer

Personal running workflow assistant.
Reads training activities from the Strava API and exports them to local JSON.
Playwright browser capture is available as a secondary, optional tool.

## Requirements

- Node.js 18+ (uses built-in `fetch`)
- Chromium — only needed for browser capture (`npx playwright install chromium`)

## Setup

```bash
npm install
cp .env.example .env
# Edit .env and fill in your Strava API credentials
```

---

## Strava API

### 1. Create a Strava API application

Go to https://www.strava.com/settings/api and create an app.
Set the **Authorization Callback Domain** to `localhost`.

Copy the **Client ID** and **Client Secret** into your `.env`:

```env
STRAVA_CLIENT_ID=your_client_id
STRAVA_CLIENT_SECRET=your_client_secret
STRAVA_REDIRECT_URI=http://localhost
```

### 2. Authenticate (one-time)

```bash
npm run strava:auth
```

This will:
1. Print an authorization URL
2. Open it in any browser (on any machine — no display required on the Pi)
3. After you authorize, Strava redirects to a URL containing a `code`
4. Paste that full URL or just the `code` into the terminal
5. Tokens are saved to `storage/auth/strava-tokens.json`

### 3. Fetch activities

```bash
npm run strava:fetch
```

Downloads your latest activities and saves them to `storage/json/activities.latest.json`.

The access token is refreshed automatically when expired.

Output format:

```json
{
  "fetched_at": "2026-03-09T19:00:00.000Z",
  "source": "strava-api",
  "count": 30,
  "activities": [ ... ]
}
```

To change how many activities are fetched, set in `.env`:

```env
STRAVA_ACTIVITIES_PER_PAGE=50
```

---

## Browser capture (optional / secondary)

Playwright-based screenshot capture for pages that don't have an API.

### Setup

```bash
npx playwright install chromium
```

### Authenticate (browser session)

```bash
npm run auth:strava   # saves to storage/auth/strava.json
```

Opens Chromium in headed mode. Log in manually, then press Enter to save the session.
To run on a headless Pi, generate the session on a machine with a display and copy it:

```bash
scp /srv/repos/personal/argensonix/labs/pacer/storage/auth/strava.json \
    rpi:/srv/repos/personal/argensonix/labs/pacer/storage/auth/strava.json
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
  strava/       Strava API integration (auth, client, activity fetch)
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

