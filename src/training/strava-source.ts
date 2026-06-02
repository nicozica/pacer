import { config } from '../config';
import { stravaGet } from '../strava/client';
import { buildActivityNameMetadata } from './activity-names';
import type { SourceActivity, SourceLap, SourceStreamPayload } from '../session/source';
import type { TrainingFetchOptions, TrainingSource } from './source';

function toEpochSeconds(date: string | undefined, boundary: 'start' | 'end'): number | null {
  if (!date) return null;
  const suffix = boundary === 'start' ? 'T00:00:00Z' : 'T23:59:59Z';
  const timestamp = Date.parse(date.includes('T') ? date : `${date}${suffix}`);
  return Number.isNaN(timestamp) ? null : Math.floor(timestamp / 1000);
}

function buildStravaActivityParams(options: TrainingFetchOptions = {}): Record<string, string | number> {
  const params: Record<string, string | number> = {
    per_page: config.stravaActivitiesPerPage,
    page: 1,
  };
  const after = toEpochSeconds(options.oldest, 'start');
  const before = toEpochSeconds(options.newest, 'end');
  if (after !== null) params.after = after;
  if (before !== null) params.before = before;
  return params;
}

function withSourceMetadata(activity: SourceActivity): SourceActivity {
  const id = typeof activity.id === 'number' ? activity.id : undefined;
  const sportType = activity.sport_type || activity.type;
  return {
    ...activity,
    source: 'strava',
    sourceActivityId: id,
    originalActivityId: id === undefined ? null : String(id),
    originalActivityUrl: id === undefined ? null : `https://www.strava.com/activities/${id}`,
    sourceActivityUrl: id === undefined ? null : `https://www.strava.com/activities/${id}`,
    ...buildActivityNameMetadata(activity.name, sportType),
  };
}

export function createStravaSource(): TrainingSource {
  return {
    name: 'strava',
    bundleSource: 'strava-api',
    displayName: 'Strava',
    async fetchActivities(options: TrainingFetchOptions = {}): Promise<SourceActivity[]> {
      const activities = await stravaGet<SourceActivity[]>('/athlete/activities', buildStravaActivityParams(options));
      return activities.map(withSourceMetadata);
    },
    async fetchActivityDetail(sourceActivityId: number): Promise<SourceActivity | null> {
      try {
        return withSourceMetadata(await stravaGet<SourceActivity>(`/activities/${sourceActivityId}`));
      } catch {
        return null;
      }
    },
    async fetchActivityLaps(sourceActivityId: number): Promise<SourceLap[]> {
      try {
        return await stravaGet<SourceLap[]>(`/activities/${sourceActivityId}/laps`);
      } catch {
        return [];
      }
    },
    async fetchActivityStreams(sourceActivityId: number): Promise<SourceStreamPayload | null> {
      try {
        return await stravaGet<SourceStreamPayload>(`/activities/${sourceActivityId}/streams`, {
          keys: 'distance,time,heartrate,velocity_smooth,moving,temp',
          key_by_type: 'true',
        });
      } catch {
        return null;
      }
    },
  };
}
