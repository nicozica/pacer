import * as assert from 'node:assert/strict';
import { normalizeGarminFitLaps } from './fit-laps';

const base = Date.parse('2026-10-15T09:06:27Z');
const fixture = [
  [0, 408.058, 420.552, 1000, 134], [423, 405.589, 405.589, 1000, 140], [828, 86.353, 86.353, 239.73, 139],
  [915, 20, 20, 79.18, 149], [934, 100, 100, 233.78, 153], [1034, 20, 20, 72.96, 146],
  [1054, 100, 100, 222.72, 147], [1154, 20, 20, 77.09, 142], [1174, 100, 100, 228.41, 148],
  [1274, 20, 20, 78.58, 145], [1294, 100, 100, 222.53, 148], [1394, 20, 20, 78.28, 148],
  [1414, 100, 100, 257.7, 153], [1514, 20, 20, 79.93, 150], [1534, 410.439, 410.439, 1000, 150],
  [1945, 378.149, 378.149, 1000, 147], [2323, 391.81, 441.629, 1000, 149], [2765, 19.602, 19.602, 48.11, 154],
  [2785, 409.809, 409.809, 1000, 151], [3194, 352.429, 352.429, 949.05, 150],
].map(([offsetS, timerS, elapsedS, distanceM, hr]) => ({
  start_time: new Date(base + offsetS * 1000),
  timestamp: new Date(base + (offsetS + elapsedS) * 1000),
  total_timer_time: timerS,
  total_elapsed_time: elapsedS,
  total_distance: distanceM,
  avg_heart_rate: hr,
  lap_trigger: 'manual',
}));

const laps = normalizeGarminFitLaps(fixture);
assert.equal(laps.length, 20);
assert.equal(laps[0].startOffsetS, 0);

const strideLaps = [4, 6, 8, 10, 12, 14].map((lapIndex) => laps[lapIndex - 1]);
assert.deepEqual(strideLaps.map((lap) => lap.movingTimeS), [20, 20, 20, 20, 20, 20]);
assert.deepEqual(strideLaps.map((lap) => lap.paceSecPerKm), [253, 274, 259, 255, 255, 250]);
assert.deepEqual(strideLaps.map((lap) => lap.averageHeartrate), [149, 146, 142, 145, 148, 150]);

const incomplete = normalizeGarminFitLaps([{ total_distance: 0 }]);
assert.equal(incomplete.length, 1);
assert.equal(incomplete[0].paceSecPerKm, null);
assert.equal(incomplete[0].startOffsetS, null);

console.log('Garmin FIT lap regression checks passed.');
