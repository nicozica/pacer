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
}

export async function fetchAndSaveActivities(): Promise<void> {
  console.log(`Fetching up to ${config.stravaActivitiesPerPage} activities from Strava...`);

  const activities = await stravaGet<unknown[]>('/athlete/activities', {
    per_page: config.stravaActivitiesPerPage,
    page: 1,
  });

  const bundle: ActivitiesBundle = {
    fetched_at: new Date().toISOString(),
    source: 'strava-api',
    count: activities.length,
    activities,
  };

  const outputDir = path.join(config.storageDir, 'json');
  ensureDir(outputDir);

  const outputFile = path.join(outputDir, 'activities.latest.json');
  fs.writeFileSync(outputFile, JSON.stringify(bundle, null, 2));

  console.log(`✓ ${activities.length} activities saved to: ${outputFile}`);
}
