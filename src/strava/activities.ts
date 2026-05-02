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
  latest_activity_streams: Record<string, unknown> | null;
  latest_activity_temp_stream: number[] | null;
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

async function fetchLatestActivityStreams(activityId: number): Promise<Record<string, unknown> | null> {
  try {
    return await stravaGet<Record<string, unknown>>(`/activities/${activityId}/streams`, {
      keys: 'distance,time,heartrate,velocity_smooth,moving,temp',
      key_by_type: 'true',
    });
  } catch (err) {
    console.warn(`Could not fetch streams for activity ${activityId}: ${(err as Error).message}`);
    return null;
  }
}

function extractTempStream(streams: Record<string, unknown> | null): number[] | null {
  const temp = streams?.temp;

  if (!temp || typeof temp !== 'object' || !Array.isArray((temp as { data?: unknown[] }).data)) {
    return null;
  }

  const filtered = (temp as { data?: unknown[] }).data!.filter((value): value is number => typeof value === 'number');
  return filtered.length > 0 ? filtered : null;
}

export async function fetchAndSaveActivities(): Promise<void> {
  console.log(`Fetching up to ${config.stravaActivitiesPerPage} activities from Strava...`);

  const activities = await stravaGet<unknown[]>('/athlete/activities', {
    per_page: config.stravaActivitiesPerPage,
    page: 1,
  });

  let latestActivityLaps: unknown[] = [];
  let latestActivityStreams: Record<string, unknown> | null = null;
  let latestActivityTempStream: number[] | null = null;
  const latestActivityId = getLatestActivityId(activities);

  if (latestActivityId !== null) {
    latestActivityLaps = await fetchLatestActivityLaps(latestActivityId);
    latestActivityStreams = await fetchLatestActivityStreams(latestActivityId);
    latestActivityTempStream = extractTempStream(latestActivityStreams);
  }

  const bundle: ActivitiesBundle = {
    fetched_at: new Date().toISOString(),
    source: 'strava-api',
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

  console.log(`✓ ${activities.length} activities saved to: ${outputFile}`);
}
