import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';

interface RawActivity {
  id?: number;
  name: string;
  sport_type: string;
  type: string;
  start_date: string;       // UTC ISO string, used for filtering
  start_date_local: string; // local time without timezone, used for display
  start_latlng?: number[];
  distance: number;
  moving_time: number;
  total_elevation_gain: number;
  average_heartrate?: number;
  max_heartrate?: number;
  average_speed: number;
}

interface RawLap {
  lap_index?: number;
  name?: string;
  distance?: number;
  moving_time?: number;
  average_speed?: number;
  average_heartrate?: number;
}

export interface ActivityCard {
  sourceActivityId: number | null;
  name: string;
  type: string;
  date: string;
  startDateUtc: string;
  startLat: number | null;
  startLon: number | null;
  distanceKm: string | null;
  durationFormatted: string;
  avgHR: number | null;
  maxHR: number | null;
  pace: string | null;     // "m:ss /km" — runs only
  speedKmh: string | null; // "XX.X km/h" — rides only
  elevationM: number | null;
}

export interface LapCard {
  lap: number;
  name: string;
  distanceKm: string | null;
  durationFormatted: string;
  pace: string | null;
  avgHR: number | null;
}

export interface WeeklySummary {
  count: number;
  runCount: number;
  rideCount: number;
  totalRunKm: number;
  totalRideKm: number;
  totalTimeMin: number;
}

export interface Summary {
  fetchedAt: string;
  latestActivity: ActivityCard | null;
  latestRun: ActivityCard | null;
  latestRide: ActivityCard | null;
  latestActivityTempC: number | null;
  latestActivityLaps: LapCard[];
  last7days: WeeklySummary;
  weatherDefaultLat: number | null;
  weatherDefaultLon: number | null;
}

const RUN_TYPES = new Set(['Run', 'TrailRun', 'VirtualRun']);
const RIDE_TYPES = new Set(['Ride', 'VirtualRide']);

function getActivityType(a: RawActivity): string {
  return a.sport_type || a.type || '';
}

function isRunType(type: string): boolean {
  return RUN_TYPES.has(type);
}

function isRideType(type: string): boolean {
  return RIDE_TYPES.has(type);
}

function toTimestamp(isoString: string): number {
  const ts = Date.parse(isoString);
  return Number.isNaN(ts) ? 0 : ts;
}

function getActivityCoords(a: RawActivity): { startLat: number | null; startLon: number | null } {
  if (!Array.isArray(a.start_latlng) || a.start_latlng.length < 2) {
    return { startLat: null, startLon: null };
  }

  const [startLat, startLon] = a.start_latlng;
  if (typeof startLat !== 'number' || typeof startLon !== 'number') {
    return { startLat: null, startLon: null };
  }

  return { startLat, startLon };
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m.toString().padStart(2, '0')}m`;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

function formatPace(speedMps: number): string | null {
  if (!speedMps || speedMps <= 0) return null;
  const secPerKm = 1000 / speedMps;
  const min = Math.floor(secPerKm / 60);
  const sec = Math.round(secPerKm % 60);
  return `${min}:${sec.toString().padStart(2, '0')} /km`;
}

function averageTempFromStream(input: unknown): number | null {
  if (!Array.isArray(input)) return null;
  const values = input.filter((v): v is number => typeof v === 'number');
  if (values.length === 0) return null;
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  return parseFloat(avg.toFixed(1));
}

function toLapCard(lap: RawLap, index: number): LapCard {
  const lapNumber = typeof lap.lap_index === 'number'
    ? (lap.lap_index > 0 ? lap.lap_index : lap.lap_index + 1)
    : index + 1;
  const movingTime = typeof lap.moving_time === 'number' ? lap.moving_time : 0;
  const averageSpeed = typeof lap.average_speed === 'number' ? lap.average_speed : 0;
  const averageHR = typeof lap.average_heartrate === 'number' ? Math.round(lap.average_heartrate) : null;
  const distance = typeof lap.distance === 'number' ? lap.distance : 0;
  const cleanName = typeof lap.name === 'string' && lap.name.trim() ? lap.name : `Lap ${lapNumber}`;

  return {
    lap: lapNumber,
    name: cleanName,
    distanceKm: distance > 0 ? (distance / 1000).toFixed(2) : null,
    durationFormatted: formatDuration(Math.round(movingTime)),
    pace: formatPace(averageSpeed),
    avgHR: averageHR,
  };
}

function toCard(a: RawActivity): ActivityCard {
  const type = getActivityType(a);
  const { startLat, startLon } = getActivityCoords(a);

  return {
    sourceActivityId: typeof (a as { id?: unknown }).id === 'number' ? (a as { id: number }).id : null,
    name: a.name,
    type,
    date: a.start_date_local.slice(0, 10),
    startDateUtc: a.start_date,
    startLat,
    startLon,
    distanceKm: a.distance > 0 ? (a.distance / 1000).toFixed(2) : null,
    durationFormatted: formatDuration(a.moving_time),
    avgHR: a.average_heartrate ? Math.round(a.average_heartrate) : null,
    maxHR: a.max_heartrate ? Math.round(a.max_heartrate) : null,
    pace: isRunType(type) ? formatPace(a.average_speed) : null,
    speedKmh: isRideType(type) && a.average_speed > 0 ? (a.average_speed * 3.6).toFixed(1) : null,
    elevationM: a.total_elevation_gain > 0 ? Math.round(a.total_elevation_gain) : null,
  };
}

export function buildSummary(): Summary {
  const filePath = path.join(config.storageDir, 'json', 'activities.latest.json');

  if (!fs.existsSync(filePath)) {
    return {
      fetchedAt: '',
      latestActivity: null,
      latestRun: null,
      latestRide: null,
      latestActivityTempC: null,
      latestActivityLaps: [],
      last7days: { count: 0, runCount: 0, rideCount: 0, totalRunKm: 0, totalRideKm: 0, totalTimeMin: 0 },
      weatherDefaultLat: config.weatherDefaultLat,
      weatherDefaultLon: config.weatherDefaultLon,
    };
  }

  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const activities: RawActivity[] = raw.activities ?? [];
  const rawLaps: RawLap[] = Array.isArray(raw.latest_activity_laps) ? raw.latest_activity_laps : [];
  const fetchedAt: string = raw.fetched_at ?? '';
  const sortedActivities = [...activities].sort((a, b) => toTimestamp(b.start_date) - toTimestamp(a.start_date));
  const latestActivityTempC = averageTempFromStream(raw.latest_activity_temp_stream);
  const latestActivityLaps = rawLaps.map((lap, index) => toLapCard(lap, index));

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  const latestActivity = sortedActivities.length > 0 ? toCard(sortedActivities[0]) : null;
  const rawRun = sortedActivities.find((a) => isRunType(getActivityType(a)));
  const rawRide = sortedActivities.find((a) => isRideType(getActivityType(a)));
  const latestRun = rawRun ? toCard(rawRun) : null;
  const latestRide = rawRide ? toCard(rawRide) : null;

  const recent = sortedActivities.filter((a) => toTimestamp(a.start_date) >= sevenDaysAgo);
  const runs7 = recent.filter((a) => isRunType(getActivityType(a)));
  const rides7 = recent.filter((a) => isRideType(getActivityType(a)));

  const last7days: WeeklySummary = {
    count: recent.length,
    runCount: runs7.length,
    rideCount: rides7.length,
    totalRunKm: parseFloat((runs7.reduce((s, a) => s + a.distance, 0) / 1000).toFixed(1)),
    totalRideKm: parseFloat((rides7.reduce((s, a) => s + a.distance, 0) / 1000).toFixed(1)),
    totalTimeMin: Math.round(recent.reduce((s, a) => s + a.moving_time, 0) / 60),
  };

  return {
    fetchedAt,
    latestActivity,
    latestRun,
    latestRide,
    latestActivityTempC,
    latestActivityLaps,
    last7days,
    weatherDefaultLat: config.weatherDefaultLat,
    weatherDefaultLon: config.weatherDefaultLon,
  };
}
