import * as assert from 'node:assert/strict';
import { buildIntervalsWellnessContext, normalizeIntervalsWellnessDay } from './wellness';

const fixture = [
  {
    id: '2026-10-13', updated: '2026-10-14T04:38:21.798+00:00', sleepSecs: 19260,
    sleepScore: 71, sleepQuality: 3, restingHR: 49, atl: 33.45825, ctl: 34.232815,
    atlLoad: 58, ctlLoad: 58, rampRate: -0.75429153,
  },
  {
    id: '2026-10-14', updated: '2026-10-15T06:37:11.044+00:00', sleepSecs: 16680,
    sleepScore: 61, sleepQuality: 3, restingHR: 49, hrv: null, weight: null,
    atl: 31.400414, ctl: 33.427376, atlLoad: 18, ctlLoad: 0, rampRate: -0.73654175,
  },
  {
    id: '2026-10-15', updated: '2026-10-16T02:50:47.608+00:00', sleepSecs: 17640,
    sleepScore: 66, sleepQuality: 3, restingHR: 46, hrv: null, weight: 78.839,
    atl: 32.944576, ctl: 33.652603, atlLoad: 43, ctlLoad: 43, rampRate: -1.4250603,
  },
];

const normalized = normalizeIntervalsWellnessDay(fixture[2]);
assert.deepEqual(normalized, {
  source: 'intervals', provenance: 'intervals_athlete_wellness', date: '2026-10-15',
  updatedAt: '2026-10-16T02:50:47.608+00:00', sleepDurationS: 17640, sleepScore: 66,
  sleepQuality: 3, restingHeartRate: 46, hrv: null, weightKg: 78.839, fitnessCtl: 33.652603,
  fatigueAtl: 32.944576, acuteTrainingLoad: 43, chronicTrainingLoad: 43, rampRate: -1.4250603,
});

const context = buildIntervalsWellnessContext('2026-10-15', fixture, '2026-10-17T00:00:00.000Z');
assert.equal(context.sessionDay?.sleepDurationS, 17640);
assert.equal(context.sessionDay?.weightKg, 78.839);
assert.equal(context.recent.daysConsidered, 3);
assert.equal(context.recent.averageSleepScore, 66);
assert.equal(context.recent.averageRestingHeartRate, 48);
assert.equal(buildIntervalsWellnessContext('2026-10-16', fixture).sessionDay, null);
assert.equal(normalizeIntervalsWellnessDay({ id: 'not-a-date' }), null);

console.log('Intervals wellness regression checks passed.');
