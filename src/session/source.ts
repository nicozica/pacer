import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';
import { stravaGet } from '../strava/client';
import { ensureDir } from '../utils/storage';

export interface SourceActivity {
  id?: number;
  name: string;
  distance: number;
  moving_time: number;
  elapsed_time?: number;
  total_elevation_gain: number;
  type: string;
  sport_type?: string;
  start_date: string;
  start_date_local: string;
  timezone?: string;
  location_city?: string | null;
  average_heartrate?: number;
  max_heartrate?: number;
  average_speed: number;
  calories?: number;
  start_latlng?: number[];
  map?: {
    summary_polyline?: string;
  };
}

export interface SourceLap {
  lap_index?: number;
  name?: string;
  distance?: number;
  moving_time?: number;
  average_speed?: number;
  average_heartrate?: number;
}

export interface SourceStreamPayload {
  [key: string]: { data?: unknown[] } | unknown[] | undefined;
}

export interface ActivityBundle {
  fetched_at: string;
  source: string;
  count: number;
  activities: SourceActivity[];
  latest_activity_laps?: SourceLap[];
  latest_activity_streams?: SourceStreamPayload | null;
  latest_activity_temp_stream?: number[] | null;
}

export interface SourceWeather {
  tempC: number | null;
  condition: string | null;
  windKmh: number | null;
}

export interface ResolvedSourceActivity {
  activity: SourceActivity;
  laps: SourceLap[];
  tempStream: number[] | null;
  streamPayload: SourceStreamPayload | null;
}

const RUN_TYPES = new Set(['Run', 'TrailRun', 'VirtualRun']);

const WEATHER_CODE_LABELS: Record<number, string> = {
  0: 'clear',
  1: 'mainly clear',
  2: 'partly cloudy',
  3: 'cloudy',
  45: 'fog',
  48: 'fog',
  51: 'light drizzle',
  53: 'drizzle',
  55: 'dense drizzle',
  56: 'freezing drizzle',
  57: 'freezing drizzle',
  61: 'light rain',
  63: 'rain',
  65: 'heavy rain',
  66: 'freezing rain',
  67: 'freezing rain',
  71: 'light snow',
  73: 'snow',
  75: 'heavy snow',
  77: 'snow grains',
  80: 'rain showers',
  81: 'rain showers',
  82: 'heavy rain showers',
  85: 'snow showers',
  86: 'snow showers',
  95: 'thunderstorm',
  96: 'thunderstorm',
  99: 'thunderstorm',
};

function getActivitiesBundlePath(): string {
  return path.join(config.storageDir, 'json', 'activities.latest.json');
}

function getStreamPayloadPath(sourceActivityId: number): string {
  return path.join(config.storageDir, 'json', 'streams', `${sourceActivityId}.json`);
}

function parseIsoTimestamp(isoString: string): number {
  if (!isoString) return NaN;
  const hasTimezone = /[zZ]|[+-]\d{2}:\d{2}$/.test(isoString);
  const normalized = hasTimezone ? isoString : `${isoString}Z`;
  return Date.parse(normalized);
}

function pickClosestHourlyIndex(hourlyTimes: unknown, targetTs: number): number {
  if (!Array.isArray(hourlyTimes) || Number.isNaN(targetTs)) return -1;

  let bestIndex = -1;
  let bestDiff = Number.POSITIVE_INFINITY;

  for (let index = 0; index < hourlyTimes.length; index += 1) {
    if (typeof hourlyTimes[index] !== 'string') continue;
    const hourTs = parseIsoTimestamp(hourlyTimes[index]);
    if (Number.isNaN(hourTs)) continue;
    const diff = Math.abs(hourTs - targetTs);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIndex = index;
    }
  }

  return bestIndex;
}

export function readActivityBundle(): ActivityBundle | null {
  const filePath = getActivitiesBundlePath();
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ActivityBundle;
}

export function getActivityType(activity: SourceActivity): string {
  return activity.sport_type || activity.type || 'Activity';
}

export function isRunLike(activity: SourceActivity): boolean {
  return RUN_TYPES.has(getActivityType(activity));
}

export function sortActivitiesDesc(activities: SourceActivity[]): SourceActivity[] {
  return [...activities].sort((left, right) => {
    return Date.parse(right.start_date) - Date.parse(left.start_date);
  });
}

export function findActivityById(bundle: ActivityBundle, sourceActivityId: number): SourceActivity | null {
  return bundle.activities.find((activity) => activity.id === sourceActivityId) ?? null;
}

export function getLatestActivityId(bundle: ActivityBundle): number | null {
  const latest = sortActivitiesDesc(bundle.activities)[0];
  return typeof latest?.id === 'number' ? latest.id : null;
}

export function getActivityLaps(bundle: ActivityBundle, sourceActivityId: number): SourceLap[] {
  if (getLatestActivityId(bundle) !== sourceActivityId) return [];
  return Array.isArray(bundle.latest_activity_laps) ? bundle.latest_activity_laps : [];
}

function getTempStreamFromPayload(payload: SourceStreamPayload | null): number[] | null {
  const tempSource = payload?.temp;

  if (Array.isArray(tempSource)) {
    const values = tempSource.filter((value): value is number => typeof value === 'number');
    return values.length > 0 ? values : null;
  }

  if (tempSource && typeof tempSource === 'object' && Array.isArray(tempSource.data)) {
    const values = tempSource.data.filter((value): value is number => typeof value === 'number');
    return values.length > 0 ? values : null;
  }

  return null;
}

export function averageTemperature(values: number[] | null | undefined): number | null {
  if (!Array.isArray(values) || values.length === 0) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return Number((total / values.length).toFixed(1));
}

export function getActivityTempFromBundle(bundle: ActivityBundle, sourceActivityId: number): number | null {
  if (getLatestActivityId(bundle) !== sourceActivityId) return null;
  if (bundle.latest_activity_streams) {
    return averageTemperature(getTempStreamFromPayload(bundle.latest_activity_streams));
  }
  return averageTemperature(bundle.latest_activity_temp_stream);
}

function getActivityTempStreamFromBundle(bundle: ActivityBundle, sourceActivityId: number): number[] | null {
  if (getLatestActivityId(bundle) !== sourceActivityId) return null;
  if (bundle.latest_activity_streams) {
    return getTempStreamFromPayload(bundle.latest_activity_streams);
  }
  return Array.isArray(bundle.latest_activity_temp_stream) ? bundle.latest_activity_temp_stream : null;
}

function getActivityStreamPayloadFromBundle(bundle: ActivityBundle, sourceActivityId: number): SourceStreamPayload | null {
  if (getLatestActivityId(bundle) !== sourceActivityId) return null;
  return bundle.latest_activity_streams ?? null;
}

function readCachedActivityStreamPayload(sourceActivityId: number): SourceStreamPayload | null {
  const filePath = getStreamPayloadPath(sourceActivityId);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as SourceStreamPayload;
  } catch {
    return null;
  }
}

function writeCachedActivityStreamPayload(sourceActivityId: number, payload: SourceStreamPayload): void {
  const filePath = getStreamPayloadPath(sourceActivityId);
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

export function paceSecPerKmFromSpeed(speedMetersPerSecond: number): number | null {
  if (typeof speedMetersPerSecond !== 'number' || speedMetersPerSecond <= 0) return null;
  return Math.round(1000 / speedMetersPerSecond);
}

export async function fetchHistoricalWeather(activity: SourceActivity): Promise<SourceWeather | null> {
  if (!Array.isArray(activity.start_latlng) || activity.start_latlng.length < 2) return null;

  const [lat, lon] = activity.start_latlng;
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;

  const day = activity.start_date.slice(0, 10);
  const url = new URL('https://archive-api.open-meteo.com/v1/archive');
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lon));
  url.searchParams.set('start_date', day);
  url.searchParams.set('end_date', day);
  url.searchParams.set('hourly', 'temperature_2m,weather_code,wind_speed_10m');
  url.searchParams.set('timezone', 'UTC');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);

  try {
    const response = await fetch(url.toString(), { signal: controller.signal });
    if (!response.ok) return null;

    const payload = await response.json() as {
      hourly?: {
        time?: unknown;
        temperature_2m?: unknown;
        weather_code?: unknown;
        wind_speed_10m?: unknown;
      };
    };

    const hourly = payload.hourly;
    const index = pickClosestHourlyIndex(hourly?.time, parseIsoTimestamp(activity.start_date));
    if (index < 0) return null;

    const tempValues = Array.isArray(hourly?.temperature_2m) ? hourly?.temperature_2m : [];
    const codeValues = Array.isArray(hourly?.weather_code) ? hourly?.weather_code : [];
    const windValues = Array.isArray(hourly?.wind_speed_10m) ? hourly?.wind_speed_10m : [];

    const tempC = typeof tempValues[index] === 'number' ? Number(tempValues[index].toFixed(1)) : null;
    const weatherCode = typeof codeValues[index] === 'number' ? codeValues[index] : null;
    const windKmh = typeof windValues[index] === 'number' ? Number(windValues[index].toFixed(1)) : null;

    return {
      tempC,
      condition: weatherCode === null ? null : (WEATHER_CODE_LABELS[weatherCode] ?? 'unknown'),
      windKmh,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchActivityDetailById(sourceActivityId: number): Promise<SourceActivity | null> {
  try {
    return await stravaGet<SourceActivity>(`/activities/${sourceActivityId}`);
  } catch {
    return null;
  }
}

async function fetchActivityLapsById(sourceActivityId: number): Promise<SourceLap[]> {
  try {
    return await stravaGet<SourceLap[]>(`/activities/${sourceActivityId}/laps`);
  } catch {
    return [];
  }
}

async function fetchActivityStreamPayloadById(sourceActivityId: number): Promise<SourceStreamPayload | null> {
  try {
    return await stravaGet<SourceStreamPayload>(`/activities/${sourceActivityId}/streams`, {
      keys: 'distance,time,heartrate,velocity_smooth,moving,temp',
      key_by_type: 'true',
    });
  } catch {
    return null;
  }
}

export async function resolveSourceActivity(bundle: ActivityBundle, sourceActivityId: number): Promise<ResolvedSourceActivity> {
  const bundledActivity = findActivityById(bundle, sourceActivityId);
  const detailedActivity = await fetchActivityDetailById(sourceActivityId);
  const activity = detailedActivity && bundledActivity
    ? {
      ...bundledActivity,
      ...detailedActivity,
    }
    : (detailedActivity ?? bundledActivity);

  if (!activity) {
    throw new Error(`Could not find source activity ${sourceActivityId}.`);
  }

  const bundledLaps = bundledActivity ? getActivityLaps(bundle, sourceActivityId) : [];
  const laps = bundledLaps.length > 0 ? bundledLaps : await fetchActivityLapsById(sourceActivityId);
  const bundledStreamPayload = bundledActivity ? getActivityStreamPayloadFromBundle(bundle, sourceActivityId) : null;
  const cachedStreamPayload = readCachedActivityStreamPayload(sourceActivityId);
  const streamPayload = bundledStreamPayload
    ?? cachedStreamPayload
    ?? await fetchActivityStreamPayloadById(sourceActivityId);

  if (streamPayload) {
    writeCachedActivityStreamPayload(sourceActivityId, streamPayload);
  }

  const bundledTempStream = bundledActivity ? getActivityTempStreamFromBundle(bundle, sourceActivityId) : null;
  const tempStream = bundledTempStream ?? getTempStreamFromPayload(streamPayload);

  return {
    activity,
    laps,
    tempStream,
    streamPayload,
  };
}
