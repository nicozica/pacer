import { config } from '../config';
import type { SourceActivity, SourceStreamPayload } from '../session/source';
import { buildActivityNameMetadata } from './activity-names';
import type { TrainingFetchOptions, TrainingSource } from './source';

const API_BASE = 'https://intervals.icu/api/v1';

type RawIntervalsActivity = Record<string, unknown>;
type RawIntervalsStream = {
  type?: unknown;
  data?: unknown;
  data2?: unknown;
};

function requireIntervalsApiKey(): string {
  if (!config.intervalsApiKey) {
    throw new Error('INTERVALS_API_KEY is required when TRAINING_SOURCE=intervals.');
  }
  return config.intervalsApiKey;
}

function authHeader(): string {
  const token = Buffer.from(`API_KEY:${requireIntervalsApiKey()}`, 'utf8').toString('base64');
  return `Basic ${token}`;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function withDefaultRange(options: TrainingFetchOptions = {}): Required<TrainingFetchOptions> {
  const newest = options.newest ?? toIsoDate(new Date());
  const oldest = options.oldest ?? toIsoDate(new Date(Date.now() - config.intervalsFetchDays * 24 * 60 * 60 * 1000));
  return { oldest, newest };
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function pickNumber(raw: RawIntervalsActivity, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = numberValue(raw[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function pickString(raw: RawIntervalsActivity, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = stringValue(raw[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function normalizeSportType(rawType: string | undefined): string {
  const compact = (rawType ?? '').replace(/[\s_-]+/g, '').toLowerCase();
  const known: Record<string, string> = {
    run: 'Run',
    running: 'Run',
    trailrun: 'TrailRun',
    treadmill: 'Run',
    treadmillrun: 'Run',
    virtualrun: 'VirtualRun',
    ride: 'Ride',
    cycling: 'Ride',
    bikeride: 'Ride',
    virtualride: 'VirtualRide',
    gravelride: 'GravelRide',
    mountainbikeride: 'MountainBikeRide',
    mtb: 'MountainBikeRide',
    ebikeride: 'EBikeRide',
    walk: 'Walk',
    walking: 'Walk',
    hike: 'Hike',
    hiking: 'Hike',
    strength: 'WeightTraining',
    strengthtraining: 'WeightTraining',
    workout: 'Workout',
    weighttraining: 'WeightTraining',
    yoga: 'Yoga',
    swim: 'Swim',
    swimming: 'Swim',
  };
  return known[compact] ?? (rawType || 'Activity');
}

function normalizeCsvHeader(value: string): string {
  return value.trim().replace(/^\uFEFF/, '').toLowerCase().replace(/[\s-]+/g, '_');
}

function parseCsv(text: string): RawIntervalsActivity[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ',') {
      row.push(cell);
      cell = '';
      continue;
    }

    if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    if (char !== '\r') {
      cell += char;
    }
  }

  if (cell || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  const [rawHeaders, ...bodyRows] = rows.filter((entry) => entry.some((value) => value.trim()));
  if (!rawHeaders) return [];

  const headers = rawHeaders.map(normalizeCsvHeader);
  return bodyRows.map((values) => {
    const record: RawIntervalsActivity = {};
    headers.forEach((header, index) => {
      record[header] = values[index] ?? '';
    });
    return record;
  });
}

function normalizeIntervalsId(value: unknown): number | undefined {
  if (typeof value === 'string') {
    const cleaned = value.trim().replace(/^i/i, '');
    const parsed = Number(cleaned);
    if (Number.isInteger(parsed)) return parsed;
  }

  const parsed = numberValue(value);
  if (parsed === undefined || !Number.isInteger(parsed)) return undefined;
  return parsed;
}

function normalizeStartDate(raw: RawIntervalsActivity): { startDate: string; startDateLocal: string } | null {
  const startDateLocal = pickString(raw, ['start_date_local', 'startDateLocal', 'start_time_local', 'date']);
  const startDate = pickString(raw, ['start_date', 'startDate', 'start_time', 'start']);
  const chosen = startDate ?? startDateLocal;
  if (!chosen) return null;
  return {
    startDate: chosen,
    startDateLocal: startDateLocal ?? chosen,
  };
}

function pickLatLng(raw: RawIntervalsActivity): number[] | undefined {
  const startLatLng = raw.start_latlng;
  if (Array.isArray(startLatLng) && startLatLng.length >= 2) {
    const lat = numberValue(startLatLng[0]);
    const lon = numberValue(startLatLng[1]);
    if (lat !== undefined && lon !== undefined) return [lat, lon];
  }

  const lat = pickNumber(raw, ['start_lat', 'startLat', 'latitude', 'lat']);
  const lon = pickNumber(raw, ['start_lng', 'start_lon', 'startLon', 'longitude', 'lon', 'lng']);
  return lat !== undefined && lon !== undefined ? [lat, lon] : undefined;
}

function pickPolyline(raw: RawIntervalsActivity): string | undefined {
  const direct = pickString(raw, ['summary_polyline', 'polyline']);
  if (direct) return direct;
  const map = raw.map;
  if (map && typeof map === 'object') {
    return pickString(map as RawIntervalsActivity, ['summary_polyline', 'polyline']);
  }
  return undefined;
}

function pickSourceUrl(raw: RawIntervalsActivity, id: number | undefined): string | null {
  const explicit = pickString(raw, ['original_activity_url', 'external_url', 'activity_url', 'url']);
  if (explicit) return explicit;
  const originalId = pickString(raw, ['id', 'activity_id', 'external_id', 'original_activity_id']);
  return originalId ? `https://intervals.icu/activities/${originalId}` : (id === undefined ? null : `https://intervals.icu/activities/${id}`);
}

function isCompletedIntervalsActivity(raw: RawIntervalsActivity): boolean {
  const category = pickString(raw, ['category', 'event_type']);
  if (category && ['WORKOUT', 'TARGET', 'NOTE'].includes(category.toUpperCase())) return false;
  if (raw.completed === false || raw.done === false) return false;
  return true;
}

export function normalizeIntervalsActivity(raw: RawIntervalsActivity): SourceActivity | null {
  const originalActivityId = pickString(raw, ['id', 'activity_id', 'external_id', 'original_activity_id', 'file_id']);
  const id = normalizeIntervalsId(raw.id ?? raw.activity_id);
  const dates = normalizeStartDate(raw);
  if (id === undefined || !dates || !isCompletedIntervalsActivity(raw)) return null;

  const name = pickString(raw, ['name', 'title']) ?? 'Untitled activity';
  const sportType = normalizeSportType(pickString(raw, ['sport_type', 'sport', 'type', 'category']));
  const nameMetadata = buildActivityNameMetadata(name, sportType);
  const distance = pickNumber(raw, ['distance', 'icu_distance']) ?? 0;
  const movingTime = pickNumber(raw, ['moving_time', 'movingTime', 'duration']) ?? pickNumber(raw, ['elapsed_time', 'elapsedTime']) ?? 0;
  const elapsedTime = pickNumber(raw, ['elapsed_time', 'elapsedTime', 'total_timer_time']) ?? movingTime;
  const averageSpeed = pickNumber(raw, ['average_speed', 'avg_speed']) ?? (movingTime > 0 ? distance / movingTime : 0);
  const sourceActivityUrl = pickSourceUrl(raw, id);
  const polyline = pickPolyline(raw);

  return {
    id,
    source: 'intervals',
    sourceActivityId: id,
    originalActivityId: originalActivityId ?? String(id),
    originalActivityUrl: sourceActivityUrl,
    sourceActivityUrl,
    ...nameMetadata,
    name,
    distance,
    moving_time: movingTime,
    elapsed_time: elapsedTime,
    total_elevation_gain: pickNumber(raw, ['total_elevation_gain', 'elevation_gain', 'icu_elevation']) ?? 0,
    type: sportType,
    sport_type: sportType,
    start_date: dates.startDate,
    start_date_local: dates.startDateLocal,
    timezone: pickString(raw, ['timezone']),
    location_city: pickString(raw, ['location_city', 'city']) ?? null,
    average_heartrate: pickNumber(raw, ['average_heartrate', 'avg_hr']),
    max_heartrate: pickNumber(raw, ['max_heartrate', 'max_hr']),
    average_speed: averageSpeed,
    average_cadence: pickNumber(raw, ['average_cadence', 'avg_cadence']),
    max_cadence: pickNumber(raw, ['max_cadence']),
    calories: pickNumber(raw, ['calories', 'kcal', 'calories_burned']),
    training_load: pickNumber(raw, ['icu_training_load', 'training_load']),
    device_name: pickString(raw, ['device_name', 'device', 'source']),
    start_latlng: pickLatLng(raw),
    map: polyline ? { summary_polyline: polyline } : undefined,
  };
}

async function intervalsGet<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const url = new URL(`${API_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: authHeader(),
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Intervals.icu API error on ${path} (${response.status}). Check INTERVALS_API_KEY and INTERVALS_ATHLETE_ID.`);
  }

  return response.json() as Promise<T>;
}

async function intervalsGetText(path: string, params: Record<string, string | number> = {}): Promise<string> {
  const url = new URL(`${API_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: authHeader(),
      Accept: 'text/csv',
    },
  });

  if (!response.ok) {
    throw new Error(`Intervals.icu API error on ${path} (${response.status}). Check INTERVALS_API_KEY and INTERVALS_ATHLETE_ID.`);
  }

  return response.text();
}

function intervalsActivityApiId(sourceActivityId: number): string {
  return `i${sourceActivityId}`;
}

function normalizeIntervalsStreamPayload(payload: unknown): SourceStreamPayload | null {
  if (!Array.isArray(payload)) {
    return null;
  }

  const streams: SourceStreamPayload = {};

  for (const entry of payload) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const raw = entry as RawIntervalsStream;
    const type = stringValue(raw.type);
    if (!type || !Array.isArray(raw.data)) {
      continue;
    }

    streams[type] = Array.isArray(raw.data2)
      ? { data: raw.data, data2: raw.data2 }
      : raw.data;
  }

  return Object.keys(streams).length > 0 ? streams : null;
}

export async function fetchRawIntervalsActivitiesCsv(options: TrainingFetchOptions = {}): Promise<RawIntervalsActivity[]> {
  const range = withDefaultRange(options);
  const payload = await intervalsGetText(`/athlete/${encodeURIComponent(config.intervalsAthleteId)}/activities.csv`, range);
  return parseCsv(payload);
}

export async function fetchRawIntervalsActivities(options: TrainingFetchOptions = {}): Promise<RawIntervalsActivity[]> {
  const range = withDefaultRange(options);
  const payload = await intervalsGet<unknown>(`/athlete/${encodeURIComponent(config.intervalsAthleteId)}/activities`, range);
  const jsonActivities = Array.isArray(payload)
    ? payload.filter((entry): entry is RawIntervalsActivity => Boolean(entry) && typeof entry === 'object')
    : [];

  return jsonActivities.length > 0 ? jsonActivities : fetchRawIntervalsActivitiesCsv(options);
}

export function createIntervalsSource(): TrainingSource {
  return {
    name: 'intervals',
    bundleSource: 'intervals-api',
    displayName: 'Intervals.icu',
    async fetchActivities(options: TrainingFetchOptions = {}): Promise<SourceActivity[]> {
      const rawActivities = await fetchRawIntervalsActivities(options);
      return rawActivities
        .map(normalizeIntervalsActivity)
        .filter((activity): activity is SourceActivity => activity !== null);
    },
    async fetchWellness(options: TrainingFetchOptions = {}): Promise<unknown[]> {
      const range = withDefaultRange(options);
      const payload = await intervalsGet<unknown>(`/athlete/${encodeURIComponent(config.intervalsAthleteId)}/wellness`, range);
      return Array.isArray(payload) ? payload : [];
    },
    async fetchActivityDetail(sourceActivityId: number): Promise<SourceActivity | null> {
      try {
        const raw = await intervalsGet<unknown>(`/activity/${intervalsActivityApiId(sourceActivityId)}`);
        return raw && typeof raw === 'object' ? normalizeIntervalsActivity(raw as RawIntervalsActivity) : null;
      } catch {
        return null;
      }
    },
    async fetchActivityStreams(sourceActivityId: number): Promise<SourceStreamPayload | null> {
      try {
        const raw = await intervalsGet<unknown>(`/activity/${intervalsActivityApiId(sourceActivityId)}/streams`);
        return normalizeIntervalsStreamPayload(raw);
      } catch {
        return null;
      }
    },
  };
}
