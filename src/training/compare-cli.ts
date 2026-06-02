import type { SourceActivity } from '../session/source';
import { parseTrainingArgs } from './cli';
import { createIntervalsSource } from './intervals-source';
import { createStravaSource } from './strava-source';

interface ComparisonRow {
  strava: SourceActivity;
  intervals: SourceActivity | null;
}

function timestamp(activity: SourceActivity): number {
  const ts = Date.parse(activity.start_date_local || activity.start_date);
  return Number.isNaN(ts) ? 0 : ts;
}

function sport(activity: SourceActivity): string {
  return activity.sport_type || activity.type || 'Activity';
}

function paceSecPerKm(activity: SourceActivity): number | null {
  const movingTime = activity.moving_time || activity.elapsed_time || 0;
  if (!activity.distance || !movingTime) return null;
  return Math.round(movingTime / (activity.distance / 1000));
}

function nearestIntervalsMatch(strava: SourceActivity, candidates: SourceActivity[], usedIds: Set<number>): SourceActivity | null {
  const stravaTs = timestamp(strava);
  const stravaSport = sport(strava);
  let best: SourceActivity | null = null;
  let bestDiff = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    if (typeof candidate.id === 'number' && usedIds.has(candidate.id)) continue;
    if (sport(candidate) !== stravaSport) continue;
    const diff = Math.abs(timestamp(candidate) - stravaTs);
    if (diff < bestDiff && diff <= 6 * 60 * 60 * 1000) {
      best = candidate;
      bestDiff = diff;
    }
  }

  if (best?.id !== undefined) usedIds.add(best.id);
  return best;
}

function diffNumber(left: number | undefined, right: number | undefined, scale = 1): string {
  if (left === undefined || right === undefined) return '-';
  const diff = (right - left) / scale;
  const rounded = Math.abs(diff) >= 10 ? Math.round(diff) : Number(diff.toFixed(1));
  return `${rounded >= 0 ? '+' : ''}${rounded}`;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function formatCell(value: string | number | null | undefined, width: number): string {
  const text = value === null || value === undefined || value === '' ? '-' : String(value);
  return text.length > width ? `${text.slice(0, Math.max(0, width - 3))}...` : text.padEnd(width, ' ');
}

async function main(): Promise<void> {
  const args = parseTrainingArgs(process.argv.slice(2));
  const stravaSource = createStravaSource();
  const intervalsSource = createIntervalsSource();
  const [stravaActivities, intervalsActivities] = await Promise.all([
    stravaSource.fetchActivities(args),
    intervalsSource.fetchActivities(args),
  ]);

  const usedIntervalsIds = new Set<number>();
  const rows: ComparisonRow[] = stravaActivities.map((strava) => ({
    strava,
    intervals: nearestIntervalsMatch(strava, intervalsActivities, usedIntervalsIds),
  }));

  console.log(`Compared Strava (${stravaActivities.length}) with Intervals.icu (${intervalsActivities.length})`);
  console.log([
    formatCell('Date', 12),
    formatCell('Sport', 12),
    formatCell('dKm', 8),
    formatCell('dTimeS', 8),
    formatCell('dPaceS', 8),
    formatCell('dHR', 8),
    formatCell('dElevM', 8),
    'Title',
  ].join('  '));

  for (const row of rows.slice(0, 30)) {
    const intervals = row.intervals;
    if (!intervals) {
      console.log([
        formatCell((row.strava.start_date_local || row.strava.start_date).slice(0, 10), 12),
        formatCell(sport(row.strava), 12),
        formatCell('missing', 8),
        formatCell('-', 8),
        formatCell('-', 8),
        formatCell('-', 8),
        formatCell('-', 8),
        row.strava.name,
      ].join('  '));
      continue;
    }

    console.log([
      formatCell((row.strava.start_date_local || row.strava.start_date).slice(0, 10), 12),
      formatCell(sport(row.strava), 12),
      formatCell(diffNumber(numberOrUndefined(row.strava.distance), numberOrUndefined(intervals.distance), 1000), 8),
      formatCell(diffNumber(numberOrUndefined(row.strava.moving_time), numberOrUndefined(intervals.moving_time)), 8),
      formatCell(diffNumber(paceSecPerKm(row.strava) ?? undefined, paceSecPerKm(intervals) ?? undefined), 8),
      formatCell(diffNumber(numberOrUndefined(row.strava.average_heartrate), numberOrUndefined(intervals.average_heartrate)), 8),
      formatCell(diffNumber(numberOrUndefined(row.strava.total_elevation_gain), numberOrUndefined(intervals.total_elevation_gain)), 8),
      row.strava.name,
    ].join('  '));
  }
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
