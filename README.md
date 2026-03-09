# Pacer

Personal running workflow assistant. Automates browser-based capture of training pages.

## Requirements

- Node.js 20+
- Chromium (installed via Playwright)

## Setup

```bash
npm install
npx playwright install chromium
cp .env.example .env
```

Edit `.env` and set the pages you want to capture:

```env
TARGET_PAGES=https://connect.garmin.com/modern/activities,https://www.strava.com/dashboard
```

## Run

```bash
npm run capture
```

Screenshots are saved to `storage/screenshots/YYYY-MM-DD/`.

## Auth state (optional)

If you need to capture pages that require login, save your browser session first:

```bash
npx playwright codegen --save-storage=storage/auth/state.json https://connect.garmin.com
```

Authenticate manually in the browser window that opens, then close it.
On the next `npm run capture` run, the saved session will be loaded automatically.

## Structure

```
src/
  config/       App configuration (reads .env)
  capture/      Main runner — launches browser, visits pages, saves screenshots
  utils/        Storage helpers

storage/
  screenshots/  Captured screenshots, organized by date
  auth/         Playwright session state (gitignored)
  json/         Future: structured data
  logs/         Future: run logs
```

## Debug (headed mode)

```bash
HEADLESS=false npm run capture
```
