import * as dotenv from 'dotenv';

dotenv.config();

export const config = {
  // Playwright capture settings
  headless: process.env.HEADLESS !== 'false',
  storageDir: process.env.STORAGE_DIR ?? 'storage',
  authStateFile: process.env.AUTH_STATE_FILE ?? 'storage/auth/strava.json',
  targetPages: (process.env.TARGET_PAGES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // Strava API settings
  stravaClientId: process.env.STRAVA_CLIENT_ID ?? '',
  stravaClientSecret: process.env.STRAVA_CLIENT_SECRET ?? '',
  stravaRedirectUri: process.env.STRAVA_REDIRECT_URI ?? 'http://localhost',
  stravaTokensFile: process.env.STRAVA_TOKENS_FILE ?? 'storage/auth/strava-tokens.json',
  stravaActivitiesPerPage: parseInt(process.env.STRAVA_ACTIVITIES_PER_PAGE ?? '30', 10),

  // Web server settings
  webHost: process.env.WEB_HOST ?? '127.0.0.1',
  webPort: parseInt(process.env.WEB_PORT ?? '3000', 10),
};
