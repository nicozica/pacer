import { fetchAndSaveActivities } from '../strava/activities';

fetchAndSaveActivities().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
