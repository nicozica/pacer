import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';
import type { SourceActivity, SourceLap, SourceStreamPayload } from '../session/source';
import { ensureDir } from '../utils/storage';
import {
  TrainingFetchOptions,
  TrainingSourceName,
  createTrainingSource,
  getConfiguredTrainingSourceName,
} from './source';

interface ActivitiesBundle {
  fetched_at: string;
  source: string;
  count: number;
  activities: SourceActivity[];
  latest_activity_laps: SourceLap[];
  latest_activity_streams: SourceStreamPayload | null;
  latest_activity_temp_stream: number[] | null;
}

export interface FetchAndSaveActivitiesOptions extends TrainingFetchOptions {
  source?: TrainingSourceName;
}

function getLatestActivityId(activities: SourceActivity[]): number | null {
  const latest = [...activities].sort((left, right) => {
    return Date.parse(right.start_date) - Date.parse(left.start_date);
  })[0];
  return typeof latest.id === 'number' ? latest.id : null;
}

function extractTempStream(streams: SourceStreamPayload | null): number[] | null {
  const temp = streams?.temp;

  if (Array.isArray(temp)) {
    const filtered = temp.filter((value): value is number => typeof value === 'number');
    return filtered.length > 0 ? filtered : null;
  }

  if (!temp || typeof temp !== 'object' || !Array.isArray((temp as { data?: unknown[] }).data)) {
    return null;
  }

  const filtered = (temp as { data?: unknown[] }).data!.filter((value): value is number => typeof value === 'number');
  return filtered.length > 0 ? filtered : null;
}

function buildRangeLabel(options: TrainingFetchOptions): string {
  if (options.oldest && options.newest) return `${options.oldest} to ${options.newest}`;
  if (options.oldest) return `since ${options.oldest}`;
  if (options.newest) return `through ${options.newest}`;
  return 'recent';
}

export async function fetchAndSaveActivities(options: FetchAndSaveActivitiesOptions = {}): Promise<void> {
  const sourceName = options.source ?? getConfiguredTrainingSourceName();
  const source = createTrainingSource(sourceName);
  const range = { oldest: options.oldest, newest: options.newest };

  console.log(`Fetching ${buildRangeLabel(range)} activities from ${source.displayName}...`);

  const activities = await source.fetchActivities(range);

  let latestActivityLaps: SourceLap[] = [];
  let latestActivityStreams: SourceStreamPayload | null = null;
  let latestActivityTempStream: number[] | null = null;
  const latestActivityId = getLatestActivityId(activities);

  if (latestActivityId !== null) {
    latestActivityLaps = source.fetchActivityLaps ? await source.fetchActivityLaps(latestActivityId) : [];
    latestActivityStreams = source.fetchActivityStreams ? await source.fetchActivityStreams(latestActivityId) : null;
    latestActivityTempStream = extractTempStream(latestActivityStreams);
  }

  const bundle: ActivitiesBundle = {
    fetched_at: new Date().toISOString(),
    source: source.bundleSource,
    count: activities.length,
    activities,
    latest_activity_laps: latestActivityLaps,
    latest_activity_streams: latestActivityStreams,
    latest_activity_temp_stream: latestActivityTempStream,
  };

  const outputDir = path.join(config.storageDir, 'json');
  ensureDir(outputDir);

  const outputFile = path.join(outputDir, 'activities.latest.json');
  fs.writeFileSync(outputFile, JSON.stringify(bundle, null, 2));

  console.log(`${activities.length} activities saved to: ${outputFile}`);
}
