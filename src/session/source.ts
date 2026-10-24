import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';
import { isWellnessCacheFresh, shouldCacheGarminDeviceLaps } from '../training/cache-freshness';
import { buildIntervalsWellnessContext } from '../training/wellness';
import { ensureDir } from '../utils/storage';
import { createTrainingSource, getTrainingSourceForBundle } from '../training/source';

export interface SourceActivity {
  id?: number;
  source?: 'intervals';
  sourceActivityId?: number;
  originalActivityId?: string | null;
  originalActivityUrl?: string | null;
  sourceActivityUrl?: string | null;
  rawActivityName?: string;
  displayActivityName?: string;
  workoutCode?: string | null;
  workoutType?: string | null;
  sessionTypeSuggestion?: string | null;
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
  average_cadence?: number;
  max_cadence?: number;
  calories?: number;
  training_load?: number;
  device_name?: string | null;
  /** Intervals.icu relation to the calendar event that generated this completed activity, when supplied. */
  pairedEventId?: number | null;
  start_latlng?: number[];
  map?: {
    summary_polyline?: string;
  };
  /**
   * Intervals.icu's detected/completed activity intervals. These are neither
   * Garmin laps nor Pacer's reconstructed kilometre splits.
   */
  intervalsSegments?: SourceActivitySegment[];
}

export interface SourceLap {
  lap_index?: number;
  name?: string;
  distance?: number;
  moving_time?: number;
  average_speed?: number;
  average_heartrate?: number;
}

export interface SourceActivitySegment {
  source: 'intervals';
  provenance: 'intervals_icu_intervals';
  sourceIntervalId: number | null;
  intervalIndex: number;
  intervalType: string | null;
  label: string | null;
  startTimeS: number | null;
  endTimeS: number | null;
  movingTimeS: number | null;
  elapsedTimeS: number | null;
  distanceM: number | null;
  averageSpeedMps: number | null;
  averagePaceSecPerKm: number | null;
  averageHeartrate: number | null;
  startIndex: number | null;
  endIndex: number | null;
}

export interface SourceGarminDeviceLap {
  source: 'garmin_fit';
  provenance: 'intervals_activity_original_fit';
  lapIndex: number;
  lapTrigger: string | null;
  startOffsetS: number | null;
  endOffsetS: number | null;
  movingTimeS: number | null;
  elapsedTimeS: number | null;
  distanceM: number | null;
  paceSecPerKm: number | null;
  averageHeartrate: number | null;
}

export interface SourceWellnessDay {
  source: 'intervals';
  provenance: 'intervals_athlete_wellness';
  date: string;
  updatedAt: string | null;
  sleepDurationS: number | null;
  sleepScore: number | null;
  sleepQuality: number | null;
  restingHeartRate: number | null;
  hrv: number | null;
  weightKg: number | null;
  fitnessCtl: number | null;
  fatigueAtl: number | null;
  acuteTrainingLoad: number | null;
  chronicTrainingLoad: number | null;
  rampRate: number | null;
}

export interface SourceWellnessContext {
  source: 'intervals';
  provenance: 'intervals_athlete_wellness';
  sessionDate: string;
  fetchedAt: string;
  sessionDay: SourceWellnessDay | null;
  recent: {
    daysConsidered: number;
    daysWithSleep: number;
    daysWithRestingHeartRate: number;
    averageSleepDurationS: number | null;
    averageSleepScore: number | null;
    averageRestingHeartRate: number | null;
  };
}

export interface SourceStreamPayload {
  [key: string]: { data?: unknown[]; data2?: unknown[] } | unknown[] | undefined;
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
  intervalsSegments: SourceActivitySegment[];
  garminDeviceLaps: SourceGarminDeviceLap[];
  wellness: SourceWellnessContext | null;
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

function getGarminDeviceLapsPath(sourceActivityId: number): string {
  return path.join(config.storageDir, 'json', 'fit-laps', `${sourceActivityId}.json`);
}

function getWellnessContextPath(sourceActivityId: number): string {
  return path.join(config.storageDir, 'json', 'wellness', `${sourceActivityId}.json`);
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

function readCachedGarminDeviceLaps(sourceActivityId: number): SourceGarminDeviceLap[] | null {
  const filePath = getGarminDeviceLapsPath(sourceActivityId);
  if (!fs.existsSync(filePath)) return null;

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as { laps?: unknown };
    return Array.isArray(parsed.laps) && parsed.laps.length > 0 ? parsed.laps as SourceGarminDeviceLap[] : null;
  } catch {
    return null;
  }
}

function writeCachedGarminDeviceLaps(sourceActivityId: number, laps: SourceGarminDeviceLap[]): void {
  const filePath = getGarminDeviceLapsPath(sourceActivityId);
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify({
    version: 1,
    source: 'intervals_activity_original_fit',
    sourceActivityId,
    fetchedAt: new Date().toISOString(),
    laps,
  }, null, 2));
}

function readCachedWellnessContext(sourceActivityId: number): SourceWellnessContext | null {
  const filePath = getWellnessContextPath(sourceActivityId);
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as SourceWellnessContext;
    return parsed?.provenance === 'intervals_athlete_wellness' && typeof parsed.sessionDate === 'string'
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function writeCachedWellnessContext(sourceActivityId: number, context: SourceWellnessContext): void {
  const filePath = getWellnessContextPath(sourceActivityId);
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(context, null, 2));
}

function shiftIsoDate(date: string, days: number): string {
  const timestamp = Date.parse(`${date}T12:00:00Z`);
  if (Number.isNaN(timestamp)) return date;
  return new Date(timestamp + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function fetchWellnessContext(
  bundle: ActivityBundle,
  sourceActivityId: number,
  sessionDate: string,
): Promise<SourceWellnessContext | null> {
  const cached = readCachedWellnessContext(sourceActivityId);
  if (cached?.sessionDate === sessionDate && isWellnessCacheFresh(sessionDate, cached.fetchedAt)) return cached;

  const source = createTrainingSource(getTrainingSourceForBundle(bundle.source));
  if (!source.fetchWellness) return null;

  try {
    const context = buildIntervalsWellnessContext(sessionDate, await source.fetchWellness({
      oldest: shiftIsoDate(sessionDate, -6),
      newest: sessionDate,
    }));
    writeCachedWellnessContext(sourceActivityId, context);
    return context;
  } catch {
    // A temporary API failure must not erase a previously useful local record.
    return cached?.sessionDate === sessionDate ? cached : null;
  }
}

export function paceSecPerKmFromSpeed(speedMetersPerSecond: number): number | null {
  if (typeof speedMetersPerSecond !== 'number' || speedMetersPerSecond <= 0) return null;
  return Math.round(1000 / speedMetersPerSecond);
}

function getLatLngPointsFromPayload(streamPayload: SourceStreamPayload | null): [number, number][] {
  const source = streamPayload?.latlng;

  if (!source) {
    return [];
  }

  if (Array.isArray(source)) {
    return source
      .filter((value): value is [number, number] => (
        Array.isArray(value)
        && typeof value[0] === 'number'
        && typeof value[1] === 'number'
      ));
  }

  if (!Array.isArray(source.data) || !Array.isArray(source.data2)) {
    return [];
  }

  const count = Math.min(source.data.length, source.data2.length);
  const points: [number, number][] = [];

  for (let index = 0; index < count; index += 1) {
    const lat = source.data[index];
    const lon = source.data2[index];

    if (typeof lat === 'number' && typeof lon === 'number') {
      points.push([lat, lon]);
    }
  }

  return points;
}

function encodePolylineCoordinate(value: number): string {
  let coordinate = value < 0 ? ~(value << 1) : value << 1;
  let output = '';

  while (coordinate >= 0x20) {
    output += String.fromCharCode((0x20 | (coordinate & 0x1f)) + 63);
    coordinate >>= 5;
  }

  return output + String.fromCharCode(coordinate + 63);
}

function encodePolyline(points: [number, number][]): string | null {
  if (points.length < 4) {
    return null;
  }

  let previousLat = 0;
  let previousLon = 0;
  let output = '';

  for (const [lat, lon] of points) {
    const encodedLat = Math.round(lat * 1e5);
    const encodedLon = Math.round(lon * 1e5);
    output += encodePolylineCoordinate(encodedLat - previousLat);
    output += encodePolylineCoordinate(encodedLon - previousLon);
    previousLat = encodedLat;
    previousLon = encodedLon;
  }

  return output;
}

function enrichActivityFromStreams(activity: SourceActivity, streamPayload: SourceStreamPayload | null): SourceActivity {
  const points = getLatLngPointsFromPayload(streamPayload);
  if (points.length === 0) {
    return activity;
  }

  const firstPoint = points[0];
  const polyline = activity.map?.summary_polyline ?? encodePolyline(points);

  return {
    ...activity,
    start_latlng: Array.isArray(activity.start_latlng) && activity.start_latlng.length >= 2
      ? activity.start_latlng
      : firstPoint,
    map: polyline
      ? { ...(activity.map ?? {}), summary_polyline: polyline }
      : activity.map,
  };
}

export async function fetchHistoricalWeather(activity: SourceActivity): Promise<SourceWeather | null> {
  const [lat, lon] = Array.isArray(activity.start_latlng) && activity.start_latlng.length >= 2
    ? activity.start_latlng
    : [config.weatherDefaultLat, config.weatherDefaultLon];
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

async function fetchActivityLapsById(bundle: ActivityBundle, sourceActivityId: number): Promise<SourceLap[]> {
  const source = createTrainingSource(getTrainingSourceForBundle(bundle.source));
  return source.fetchActivityLaps ? source.fetchActivityLaps(sourceActivityId) : [];
}

async function fetchActivityStreamPayloadById(bundle: ActivityBundle, sourceActivityId: number): Promise<SourceStreamPayload | null> {
  const source = createTrainingSource(getTrainingSourceForBundle(bundle.source));
  return source.fetchActivityStreams ? source.fetchActivityStreams(sourceActivityId) : null;
}

async function fetchGarminDeviceLapsById(bundle: ActivityBundle, sourceActivityId: number): Promise<SourceGarminDeviceLap[] | null> {
  const source = createTrainingSource(getTrainingSourceForBundle(bundle.source));
  return source.fetchActivityGarminDeviceLaps ? source.fetchActivityGarminDeviceLaps(sourceActivityId) : null;
}

export async function resolveSourceActivity(bundle: ActivityBundle, sourceActivityId: number): Promise<ResolvedSourceActivity> {
  const bundledActivity = findActivityById(bundle, sourceActivityId);
  const source = createTrainingSource(getTrainingSourceForBundle(bundle.source));
  const detailedActivity = source.fetchActivityDetail ? await source.fetchActivityDetail(sourceActivityId) : null;
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
  const laps = bundledLaps.length > 0 ? bundledLaps : await fetchActivityLapsById(bundle, sourceActivityId);
  const bundledStreamPayload = bundledActivity ? getActivityStreamPayloadFromBundle(bundle, sourceActivityId) : null;
  const cachedStreamPayload = readCachedActivityStreamPayload(sourceActivityId);
  const streamPayload = bundledStreamPayload
    ?? cachedStreamPayload
    ?? await fetchActivityStreamPayloadById(bundle, sourceActivityId);

  if (streamPayload) {
    writeCachedActivityStreamPayload(sourceActivityId, streamPayload);
  }

  const cachedGarminDeviceLaps = readCachedGarminDeviceLaps(sourceActivityId);
  const fetchedGarminDeviceLaps = cachedGarminDeviceLaps === null
    ? await fetchGarminDeviceLapsById(bundle, sourceActivityId)
    : null;
  const garminDeviceLaps = cachedGarminDeviceLaps ?? fetchedGarminDeviceLaps ?? [];
  if (shouldCacheGarminDeviceLaps(fetchedGarminDeviceLaps)) {
    writeCachedGarminDeviceLaps(sourceActivityId, fetchedGarminDeviceLaps);
  }

  const bundledTempStream = bundledActivity ? getActivityTempStreamFromBundle(bundle, sourceActivityId) : null;
  const tempStream = bundledTempStream ?? getTempStreamFromPayload(streamPayload);
  const enrichedActivity = enrichActivityFromStreams(activity, streamPayload);
  const sessionDate = (activity.start_date_local || activity.start_date).slice(0, 10);
  const wellness = await fetchWellnessContext(bundle, sourceActivityId, sessionDate);

  return {
    activity: enrichedActivity,
    laps,
    intervalsSegments: Array.isArray(activity.intervalsSegments) ? activity.intervalsSegments : [],
    garminDeviceLaps,
    wellness,
    tempStream,
    streamPayload,
  };
}
