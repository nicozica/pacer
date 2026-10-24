import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { normalizeIntervalsActivitySegments } from './intervals-source';

const fixturePath = path.join(__dirname, 'fixtures', 'intervals-activity-segments.fixture.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as Record<string, unknown>;
const segments = normalizeIntervalsActivitySegments(fixture);

assert.equal(segments.length, 4, 'invalid interval entries are skipped without discarding incomplete valid entries');

assert.deepEqual(segments[0], {
  source: 'intervals',
  provenance: 'intervals_icu_intervals',
  sourceIntervalId: 8533964,
  intervalIndex: 1,
  intervalType: 'RECOVERY',
  label: null,
  startTimeS: 0,
  endTimeS: 0,
  movingTimeS: 2,
  elapsedTimeS: 2,
  distanceM: null,
  averageSpeedMps: null,
  averagePaceSecPerKm: null,
  averageHeartrate: null,
  startIndex: 0,
  endIndex: 0,
});

assert.equal(segments[1].intervalType, 'WORK');
assert.equal(segments[1].movingTimeS, 20);
assert.equal(segments[1].averageSpeedMps, 3.6065063);
assert.equal(segments[1].averagePaceSecPerKm, 277);
assert.equal(segments[2].movingTimeS, 100);
assert.equal(segments[2].averagePaceSecPerKm, 457);

const incomplete = segments[3];
assert.equal(incomplete.sourceIntervalId, null);
assert.equal(incomplete.startTimeS, null);
assert.equal(incomplete.averagePaceSecPerKm, null);
assert.equal(incomplete.distanceM, null);

console.log('Intervals activity-segment regression checks passed.');
