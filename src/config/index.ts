import * as dotenv from 'dotenv';
import * as fs from 'fs';
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

function parseBoolean(input: string | undefined): boolean {
  return input?.trim().toLowerCase() === 'true';
}

function resolveRunSiteRacesFile(): string | null {
  const explicitFile = process.env.RUN_SITE_RACES_FILE?.trim();
  if (explicitFile) {
    return path.resolve(explicitFile);
  }

  const runRepo = process.env.RUN_REPO?.trim();
  if (runRepo) {
    return path.resolve(runRepo, 'data', 'manual', 'races.json');
  }

  const localSiblingFile = path.resolve(process.cwd(), '..', 'run-nico-ar', 'data', 'manual', 'races.json');
  return fs.existsSync(localSiblingFile) ? localSiblingFile : null;
}

export const config = {
  // Runtime storage root
  storageDir: process.env.STORAGE_DIR ?? 'storage',
  databaseFile: process.env.DATABASE_FILE ?? path.join(process.env.STORAGE_DIR ?? 'storage', 'db', 'pacer.sqlite'),
  cmsExportDir: process.env.CMS_EXPORT_DIR ?? path.join(process.env.STORAGE_DIR ?? 'storage', 'json', 'cms'),

  // Playwright capture settings
  headless: process.env.HEADLESS !== 'false',
  authStateFile: process.env.AUTH_STATE_FILE ?? path.join(process.env.STORAGE_DIR ?? 'storage', 'auth', 'browser-state.json'),
  targetPages: (process.env.TARGET_PAGES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // Intervals.icu API settings
  trainingSource: process.env.TRAINING_SOURCE ?? 'intervals',
  intervalsApiKey: process.env.INTERVALS_API_KEY ?? '',
  intervalsApiBaseUrl: process.env.INTERVALS_API_BASE_URL ?? 'https://intervals.icu/api/v1',
  intervalsAthleteId: process.env.INTERVALS_ATHLETE_ID ?? '0',
  intervalsFetchDays: parseIntWithFallback(process.env.INTERVALS_FETCH_DAYS, 180),

  // Optional Garmin Personal API wellness overlay. It is deliberately disabled
  // unless explicitly enabled, and credentials remain outside this repository.
  garminWellnessEnabled: parseBoolean(process.env.GARMIN_WELLNESS_ENABLED),
  garminPersonalApiBaseUrl: process.env.GARMIN_PERSONAL_API_BASE_URL ?? 'https://personal.connectapi.garmin.com',
  garminPersonalApiKeyFile: process.env.GARMIN_PERSONAL_API_KEY_FILE ?? '/srv/repos/.garmin-personal-api-poc/credentials/api-key',
  // Deliberately separate from the Python POC's bearer-token cache.
  garminPersonalBearerTokenCacheFile: process.env.GARMIN_PERSONAL_BEARER_TOKEN_CACHE_FILE ?? '/srv/repos/.garmin-personal-api-poc/credentials/pacer-bearer-token.json',
  garminWellnessTimeoutMs: parseIntWithFallback(process.env.GARMIN_WELLNESS_TIMEOUT_MS, 8_000),
  garminWellnessTotalTimeoutMs: parseIntWithFallback(process.env.GARMIN_WELLNESS_TOTAL_TIMEOUT_MS, 15_000),
  garminWellnessTimeZone: process.env.GARMIN_WELLNESS_TIME_ZONE ?? 'America/Argentina/Buenos_Aires',
  garminPersonalApiKeyExpiresOn: process.env.GARMIN_PERSONAL_API_KEY_EXPIRES_ON ?? '2027-10-24',

  // Web server settings
  webHost: process.env.WEB_HOST ?? '127.0.0.1',
  webPort: parseInt(process.env.WEB_PORT ?? '3000', 10),

  // Local publish hook settings
  runSiteDeployScript:
    process.env.RUN_SITE_DEPLOY_SCRIPT
    ?? path.resolve(process.cwd(), 'scripts', 'publish-run-site.sh'),
  runSiteDeployTimeoutMs: parseIntWithFallback(process.env.RUN_SITE_DEPLOY_TIMEOUT_MS, 300_000),
  runSiteRacesFile: resolveRunSiteRacesFile(),

  // Optional weather fallback location (used when activity has no coordinates)
  weatherDefaultLat: parseOptionalFloat(process.env.WEATHER_DEFAULT_LAT),
  weatherDefaultLon: parseOptionalFloat(process.env.WEATHER_DEFAULT_LON),
};
