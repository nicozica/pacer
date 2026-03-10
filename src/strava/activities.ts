import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';
import { stravaGet } from './client';
import { ensureDir } from '../utils/storage';

interface ActivitiesBundle {
  fetched_at: string;
  source: string;
  count: number;
  activities: unknown[];
  latest_activity_laps: unknown[];
  latest_activity_temp_stream: number[] | null;
}

interface StravaStreamByType {
  temp?: { data?: unknown[] };
}

function getLatestActivityId(activities: unknown[]): number | null {
  if (activities.length === 0) return null;
  const latest = activities[0] as { id?: unknown };
  return typeof latest.id === 'number' ? latest.id : null;
}

async function fetchLatestActivityLaps(activityId: number): Promise<unknown[]> {
  try {
    return await stravaGet<unknown[]>(`/activities/${activityId}/laps`);
  } catch (err) {
    console.warn(`Could not fetch laps for activity ${activityId}: ${(err as Error).message}`);
    return [];
  }
}

async function fetchLatestActivityTempStream(activityId: number): Promise<number[] | null> {
  try {
    const streams = await stravaGet<StravaStreamByType>(`/activities/${activityId}/streams`, {
      keys: 'temp',
      key_by_type: 'true',
    });
    const tempValues = streams?.temp?.data;
    if (!Array.isArray(tempValues)) return null;
    const filtered = tempValues.filter((v): v is number => typeof v === 'number');
    return filtered.length > 0 ? filtered : null;
  } catch (err) {
    console.warn(`Could not fetch temp stream for activity ${activityId}: ${(err as Error).message}`);
    return null;
  }
}

export async function fetchAndSaveActivities(): Promise<void> {
  console.log(`Fetching up to ${config.stravaActivitiesPerPage} activities from Strava...`);

  const activities = await stravaGet<unknown[]>('/athlete/activities', {
    per_page: config.stravaActivitiesPerPage,
    page: 1,
  });

  let latestActivityLaps: unknown[] = [];
  let latestActivityTempStream: number[] | null = null;
  const latestActivityId = getLatestActivityId(activities);

  if (latestActivityId !== null) {
    latestActivityLaps = await fetchLatestActivityLaps(latestActivityId);
    latestActivityTempStream = await fetchLatestActivityTempStream(latestActivityId);
  }

  const bundle: ActivitiesBundle = {
    fetched_at: new Date().toISOString(),
    source: 'strava-api',
    count: activities.length,
    activities,
    latest_activity_laps: latestActivityLaps,
    latest_activity_temp_stream: latestActivityTempStream,
  };

  const outputDir = path.join(config.storageDir, 'json');
  ensureDir(outputDir);

  const outputFile = path.join(outputDir, 'activities.latest.json');
  fs.writeFileSync(outputFile, JSON.stringify(bundle, null, 2));

  console.log(`✓ ${activities.length} activities saved to: ${outputFile}`);
}
