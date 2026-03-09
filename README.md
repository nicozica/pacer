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

## Auth state

Pages that require login need a saved session. Auth scripts handle this:

```bash
npm run auth:strava   # saves to storage/auth/strava.json
npm run auth:garmin   # saves to storage/auth/garmin.json
```

Each script will:
1. Open Chromium in **headed mode** (visible window)
2. Navigate to the site's login page
3. Wait for you to log in manually
4. Ask you to press **Enter** in the terminal to confirm
5. Save the session to the corresponding file

If the file already exists, you'll see a warning before it's overwritten.

Then set `AUTH_STATE_FILE` in your `.env` to the file you want to use:

```env
AUTH_STATE_FILE=storage/auth/strava.json
```

### Generating auth state on a machine with a display

The Raspberry Pi is often used headless via SSH. In that case, generate the auth
state on a machine with a GUI and copy it to the Pi:

```bash
# On your desktop/laptop, inside the project directory:
npm run auth:strava

# Copy the resulting file to the Pi using your SSH alias:
scp /srv/repos/personal/argensonix/labs/pacer/storage/auth/strava.json \
    rpi:/srv/repos/personal/argensonix/labs/pacer/storage/auth/strava.json
```

The Pi can then run `npm run capture` in headless mode using the copied session.

## Structure

```
src/
  config/       App configuration (reads .env)
  auth/         Auth scripts — manual login flow, saves storage state per site
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
