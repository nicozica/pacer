import { parseTrainingArgs } from './cli';
import { fetchAndSaveActivities } from './fetch';

fetchAndSaveActivities(parseTrainingArgs(process.argv.slice(2))).catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
