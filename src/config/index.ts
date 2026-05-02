import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config();

function parseOptionalFloat(input: string | undefined): number | null {
  if (!input) return null;
  const n = parseFloat(input);
  return Number.isNaN(n) ? null : n;
}

function parseIntWithFallback(input: string | undefined, fallback: number): number {
  if (!input) return fallback;
  const n = parseInt(input, 10);
  return Number.isNaN(n) ? fallback : n;
}

export const config = {
  // Runtime storage root
  storageDir: process.env.STORAGE_DIR ?? 'storage',
  databaseFile: process.env.DATABASE_FILE ?? path.join(process.env.STORAGE_DIR ?? 'storage', 'db', 'pacer.sqlite'),
  cmsExportDir: process.env.CMS_EXPORT_DIR ?? path.join(process.env.STORAGE_DIR ?? 'storage', 'json', 'cms'),

  // Playwright capture settings
  headless: process.env.HEADLESS !== 'false',
  authStateFile: process.env.AUTH_STATE_FILE ?? path.join(process.env.STORAGE_DIR ?? 'storage', 'auth', 'strava.json'),
  targetPages: (process.env.TARGET_PAGES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // Strava API settings
  stravaClientId: process.env.STRAVA_CLIENT_ID ?? '',
  stravaClientSecret: process.env.STRAVA_CLIENT_SECRET ?? '',
  stravaRedirectUri: process.env.STRAVA_REDIRECT_URI ?? 'http://localhost',
  stravaTokensFile: process.env.STRAVA_TOKENS_FILE ?? path.join(process.env.STORAGE_DIR ?? 'storage', 'auth', 'strava-tokens.json'),
  stravaActivitiesPerPage: parseInt(process.env.STRAVA_ACTIVITIES_PER_PAGE ?? '30', 10),

  // Web server settings
  webHost: process.env.WEB_HOST ?? '127.0.0.1',
  webPort: parseInt(process.env.WEB_PORT ?? '3000', 10),

  // Local publish hook settings
  runSiteDeployScript:
    process.env.RUN_SITE_DEPLOY_SCRIPT
    ?? path.resolve(process.cwd(), 'scripts', 'publish-run-site.sh'),
  runSiteDeployTimeoutMs: parseIntWithFallback(process.env.RUN_SITE_DEPLOY_TIMEOUT_MS, 300_000),

  // Optional weather fallback location (used when activity has no coordinates)
  weatherDefaultLat: parseOptionalFloat(process.env.WEATHER_DEFAULT_LAT),
  weatherDefaultLon: parseOptionalFloat(process.env.WEATHER_DEFAULT_LON),
};
