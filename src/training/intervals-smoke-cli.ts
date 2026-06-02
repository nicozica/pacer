import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';
import { ensureDir } from '../utils/storage';
import { parseTrainingArgs } from './cli';
import { fetchRawIntervalsActivities, normalizeIntervalsActivity } from './intervals-source';

function formatDistanceKm(distanceM: number): string {
  return distanceM > 0 ? (distanceM / 1000).toFixed(2) : '-';
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '-';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h${minutes.toString().padStart(2, '0')}` : `${minutes}m`;
}

function formatPace(distanceM: number, seconds: number): string {
  if (distanceM <= 0 || seconds <= 0) return '-';
  const secPerKm = seconds / (distanceM / 1000);
  const minutes = Math.floor(secPerKm / 60);
  const remaining = Math.round(secPerKm % 60);
  return `${minutes}:${remaining.toString().padStart(2, '0')}`;
}

function formatCell(value: string | number | null | undefined, width: number): string {
  const text = value === null || value === undefined || value === '' ? '-' : String(value);
  return text.length > width ? `${text.slice(0, Math.max(0, width - 3))}...` : text.padEnd(width, ' ');
}

async function main(): Promise<void> {
  const args = parseTrainingArgs(process.argv.slice(2));
  const rawActivities = await fetchRawIntervalsActivities(args);
  const activities = rawActivities
    .map(normalizeIntervalsActivity)
    .filter((activity): activity is NonNullable<typeof activity> => activity !== null);

  if (args.writeRaw) {
    const outputDir = path.join(config.storageDir, 'json', 'debug');
    ensureDir(outputDir);
    const oldest = args.oldest ?? 'default';
    const newest = args.newest ?? 'default';
    const outputFile = path.join(outputDir, `intervals-activities-${oldest}-${newest}.json`);
    fs.writeFileSync(outputFile, JSON.stringify(rawActivities, null, 2));
    console.log(`Raw Intervals.icu response written to ${outputFile}`);
  }

  console.log(`Intervals.icu activities: ${activities.length}`);
  console.log([
    formatCell('Date', 12),
    formatCell('Sport', 14),
    formatCell('Km', 8),
    formatCell('Time', 8),
    formatCell('Pace', 8),
    formatCell('HR', 9),
    formatCell('Load', 7),
    'Title',
  ].join('  '));

  for (const activity of activities.slice(0, 20)) {
    const hr = activity.average_heartrate
      ? `${Math.round(activity.average_heartrate)}${activity.max_heartrate ? `/${Math.round(activity.max_heartrate)}` : ''}`
      : '-';
    console.log([
      formatCell((activity.start_date_local || activity.start_date).slice(0, 10), 12),
      formatCell(activity.sport_type || activity.type, 14),
      formatCell(formatDistanceKm(activity.distance), 8),
      formatCell(formatDuration(activity.moving_time || activity.elapsed_time || 0), 8),
      formatCell(formatPace(activity.distance, activity.moving_time || activity.elapsed_time || 0), 8),
      formatCell(hr, 9),
      formatCell(activity.training_load ?? null, 7),
      activity.name,
    ].join('  '));
  }
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
