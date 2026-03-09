import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';

interface RawActivity {
  name: string;
  sport_type: string;
  type: string;
  start_date: string;       // UTC ISO string, used for filtering
  start_date_local: string; // local time without timezone, used for display
  distance: number;
  moving_time: number;
  total_elevation_gain: number;
  average_heartrate?: number;
  max_heartrate?: number;
  average_speed: number;
}

export interface ActivityCard {
  name: string;
  type: string;
  date: string;
  distanceKm: string | null;
  durationFormatted: string;
  avgHR: number | null;
  maxHR: number | null;
  pace: string | null;     // "m:ss /km" — runs only
  speedKmh: string | null; // "XX.X km/h" — rides only
  elevationM: number | null;
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
  last7days: WeeklySummary;
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

function toCard(a: RawActivity): ActivityCard {
  const type = a.sport_type || a.type;
  const isRun = type === 'Run' || type === 'TrailRun';
  const isRide = type === 'Ride' || type === 'VirtualRide';

  return {
    name: a.name,
    type,
    date: a.start_date_local.slice(0, 10),
    distanceKm: a.distance > 0 ? (a.distance / 1000).toFixed(2) : null,
    durationFormatted: formatDuration(a.moving_time),
    avgHR: a.average_heartrate ? Math.round(a.average_heartrate) : null,
    maxHR: a.max_heartrate ? Math.round(a.max_heartrate) : null,
    pace: isRun ? formatPace(a.average_speed) : null,
    speedKmh: isRide && a.average_speed > 0 ? (a.average_speed * 3.6).toFixed(1) : null,
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
      last7days: { count: 0, runCount: 0, rideCount: 0, totalRunKm: 0, totalRideKm: 0, totalTimeMin: 0 },
    };
  }

  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const activities: RawActivity[] = raw.activities ?? [];
  const fetchedAt: string = raw.fetched_at ?? '';

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  const latestActivity = activities.length > 0 ? toCard(activities[0]) : null;
  const rawRun = activities.find((a) => (a.sport_type || a.type) === 'Run');
  const rawRide = activities.find((a) => (a.sport_type || a.type) === 'Ride');
  const latestRun = rawRun ? toCard(rawRun) : null;
  const latestRide = rawRide ? toCard(rawRide) : null;

  const recent = activities.filter((a) => new Date(a.start_date).getTime() >= sevenDaysAgo);
  const runs7 = recent.filter((a) => (a.sport_type || a.type) === 'Run');
  const rides7 = recent.filter((a) => (a.sport_type || a.type) === 'Ride');

  const last7days: WeeklySummary = {
    count: recent.length,
    runCount: runs7.length,
    rideCount: rides7.length,
    totalRunKm: parseFloat((runs7.reduce((s, a) => s + a.distance, 0) / 1000).toFixed(1)),
    totalRideKm: parseFloat((rides7.reduce((s, a) => s + a.distance, 0) / 1000).toFixed(1)),
    totalTimeMin: Math.round(recent.reduce((s, a) => s + a.moving_time, 0) / 60),
  };

  return { fetchedAt, latestActivity, latestRun, latestRide, last7days };
}
