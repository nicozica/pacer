import { runAuthFlow } from '../strava/auth';

runAuthFlow().catch((err) => {
  console.error(err);
  process.exit(1);
});
