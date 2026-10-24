import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { normalizeGarminFitLaps } from '../training/fit-laps';
import { normalizeIntervalsActivitySegments } from '../training/intervals-source';
import { buildIntervalsWellnessContext } from '../training/wellness';
import type { EditorSession } from './types';

const brief = require('../../web/brief-segments.js') as {
  formatGarminDeviceLaps(laps: unknown): string[];
  formatDetectedIntervals(segments: unknown): string[];
  formatWellness(context: unknown): string[];
  summarizeDetectedIntervals(segments: unknown): string[];
};

const segmentFixturePath = path.join(__dirname, '..', 'training', 'fixtures', 'intervals-activity-segments.fixture.json');
const intervalSegments = normalizeIntervalsActivitySegments(JSON.parse(fs.readFileSync(segmentFixturePath, 'utf8')));
const garminDeviceLaps = normalizeGarminFitLaps([
  {
    start_time: new Date('2026-10-17T10:00:00Z'), timestamp: new Date('2026-10-17T10:05:00Z'),
    total_timer_time: 300, total_elapsed_time: 300, total_distance: 1000, avg_heart_rate: 140, lap_trigger: 'manual',
  },
]);
const wellness = buildIntervalsWellnessContext('2026-10-17', [{
  id: '2026-10-17', updated: '2026-10-17T12:00:00.000Z', sleepSecs: 25200, sleepScore: 80,
  restingHR: 48, ctl: 35.5, atl: 32.5, atlLoad: 25, ctlLoad: 25,
}], '2026-10-17T12:05:00.000Z');

const editor: Pick<EditorSession, 'selectedSourceActivityId' | 'source' | 'manual' | 'laps' | 'lapSource' | 'intervalsSegments' | 'garminDeviceLaps' | 'wellness'> = {
  selectedSourceActivityId: 999001,
  source: {
    sourceActivityId: 999001, sessionDate: '2026-10-17', title: 'Newly synced run', rawActivityName: 'Newly synced run',
    displayActivityName: 'Newly synced run', workoutCode: null, sessionTypeSuggestion: null, sport: 'Run', source: 'intervals-api',
    distanceKm: 1, movingTimeLabel: '5:00', elapsedTimeLabel: '5:00', paceLabel: '5:00 /km', hrLine: '140 avg bpm',
    elevationLabel: null, weatherLine: null, city: null,
  },
  manual: { sessionType: 'Easy Run', legs: 'Good', sleepScore: 72, restedness: '4 - Good', extraNotes: 'Keep this subjective note.' },
  laps: [{ id: null, lapIndex: 1, distanceM: 1000, durationS: 300, paceSecPerKm: 300, hrAvg: 140, lapSource: 'intervals' }],
  lapSource: 'intervals',
  intervalsSegments: intervalSegments,
  garminDeviceLaps,
  wellness,
};

assert.equal(editor.selectedSourceActivityId, editor.source.sourceActivityId);
assert.equal(editor.source.sessionDate, wellness.sessionDate);
assert.equal(editor.garminDeviceLaps.length, 1);
assert.equal(editor.laps[0].lapSource, 'intervals', 'automatic kilometre splits remain separate from device laps');
assert.equal(editor.manual.extraNotes, 'Keep this subjective note.', 'wellness does not overwrite subjective input');
assert.match(brief.formatGarminDeviceLaps(editor.garminDeviceLaps)[0], /Garmin lap 1/);
assert.match(brief.formatWellness(editor.wellness)[1], /sleep 7h 0m/);
assert.match(brief.summarizeDetectedIntervals(editor.intervalsSegments)[0], /analytical estimates/);
assert.match(brief.formatDetectedIntervals(editor.intervalsSegments)[0], /Segment 1/);

console.log('Newly synchronized activity end-to-end regression checks passed.');
