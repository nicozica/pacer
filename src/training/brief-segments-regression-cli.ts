import * as assert from 'node:assert/strict';
import type { SourceActivitySegment, SourceGarminDeviceLap } from '../session/source';

const {
  detectedIntervalsDisclaimer,
  formatDetectedIntervals,
  formatGarminDeviceLaps,
  formatWellness,
  summarizeDetectedIntervals,
  garminDeviceLapsDisclaimer,
} = require('../../web/brief-segments.js') as {
  detectedIntervalsDisclaimer: string;
  formatDetectedIntervals(segments: SourceActivitySegment[] | null | undefined): string[];
  formatGarminDeviceLaps(laps: SourceGarminDeviceLap[] | null | undefined): string[];
  formatWellness(context: unknown): string[];
  summarizeDetectedIntervals(segments: SourceActivitySegment[] | null | undefined): string[];
  garminDeviceLapsDisclaimer: string;
};

const segments: SourceActivitySegment[] = [
  {
    source: 'intervals',
    provenance: 'intervals_icu_intervals',
    sourceIntervalId: 7204146,
    intervalIndex: 7,
    intervalType: 'WORK',
    label: null,
    startTimeS: 1040,
    endTimeS: 1060,
    movingTimeS: 20,
    elapsedTimeS: 20,
    distanceM: 72.13013,
    averageSpeedMps: 3.6065063,
    averagePaceSecPerKm: 277,
    averageHeartrate: 146,
    startIndex: 336,
    endIndex: 342,
  },
  {
    source: 'intervals',
    provenance: 'intervals_icu_intervals',
    sourceIntervalId: null,
    intervalIndex: 8,
    intervalType: null,
    label: null,
    startTimeS: null,
    endTimeS: null,
    movingTimeS: null,
    elapsedTimeS: null,
    distanceM: null,
    averageSpeedMps: null,
    averagePaceSecPerKm: null,
    averageHeartrate: null,
    startIndex: null,
    endIndex: null,
  },
];

const lines = formatDetectedIntervals(segments);
assert.equal(lines.length, 2);
assert.equal(
  lines[0],
  'Segment 7 | source type WORK | moving duration 0:20 | distance 0.07 km | average pace 4:37 /km | average HR 146 bpm | offsets 17:20 → 17:40',
);

const garminLaps: SourceGarminDeviceLap[] = [{
  source: 'garmin_fit',
  provenance: 'intervals_activity_original_fit',
  lapIndex: 4,
  lapTrigger: 'manual',
  startOffsetS: 915,
  endOffsetS: 935,
  movingTimeS: 20,
  elapsedTimeS: 20,
  distanceM: 79.18,
  paceSecPerKm: 253,
  averageHeartrate: 149,
}];
assert.deepEqual(formatGarminDeviceLaps(garminLaps), [
  'Garmin lap 4 | trigger manual | moving duration 0:20 | distance 0.08 km | pace 4:13 /km | average HR 149 bpm | offsets 15:15 → 15:35',
]);
assert.deepEqual(formatGarminDeviceLaps([]), ['Garmin device laps: unavailable from the original FIT.']);
assert.equal(
  garminDeviceLapsDisclaimer,
  'Source note: original FIT device laps are completed boundaries; they do not prove planned workout-step semantics.',
);
assert.match(lines[1], /source type —/);
assert.match(lines[1], /elapsed duration —/);
assert.deepEqual(formatDetectedIntervals([]), ['Detected intervals: unavailable from Intervals.icu.']);
assert.deepEqual(summarizeDetectedIntervals(segments), [
  'Detected intervals: 2 Intervals.icu analytical estimates are available in the editor API; omitted here because original FIT Garmin device laps are present above.',
]);
assert.equal(
  detectedIntervalsDisclaimer,
  'Source note: detected segments are Intervals.icu analysis, not Garmin/device laps or confirmed workout steps.',
);

assert.deepEqual(formatWellness({
  provenance: 'intervals_athlete_wellness',
  sessionDate: '2026-10-15',
  sessionDay: {
    updatedAt: '2026-10-16T02:50:47.608+00:00', sleepDurationS: 17640, sleepScore: 66,
    restingHeartRate: 46, hrv: null, weightKg: 78.839, fitnessCtl: 33.652603,
    fatigueAtl: 32.944576, acuteTrainingLoad: 43, chronicTrainingLoad: 43,
  },
  recent: { daysConsidered: 3, averageSleepDurationS: 17880, averageSleepScore: 66, averageRestingHeartRate: 48 },
}), [
  'Source: Intervals.icu daily wellness | session date 2026-10-15 | record updated 2026-10-16T02:50:47.608+00:00',
  'Session-day: sleep 4h 54m | sleep score 66/100 | resting HR 46 bpm | weight 78.8 kg (Intervals) | fitness CTL 33.7 | fatigue ATL 32.9 | acute load 43 | chronic load 43',
  'Recent recovery (3 days): average sleep 4h 58m | average sleep score 66/100 | average resting HR 48 bpm',
  'Source note: CTL/ATL and load are Intervals training-model metrics, not Garmin Body Battery. Weight is a single Intervals reading and may mirror a Garmin-synced BLE scale measurement.',
]);
assert.deepEqual(formatWellness(null), ['Wellness: unavailable from Intervals.icu for this session date.']);
const garminBrief = formatWellness({
  provenance: 'intervals_athlete_wellness', sessionDate: '2026-10-15',
  sessionDay: { updatedAt: null, sleepDurationS: 100, sleepScore: 1, restingHeartRate: 99, hrv: null, weightKg: 99, fitnessCtl: 33, fatigueAtl: 31, acuteTrainingLoad: 44, chronicTrainingLoad: 42 },
  recent: { daysConsidered: 1, averageSleepDurationS: 100, averageSleepScore: 1, averageRestingHeartRate: 99 },
  garmin: { provenance: 'garmin_personal_api_wellness', availability: 'fresh', sessionDay: { sleepDurationS: 25200, sleepScore: 82, sleepStartLocal: '2026-10-15 00:00', sleepEndLocal: '2026-10-15 07:00', restingHeartRate: 49, weightKg: 80.1, bodyBatteryMorning: 72, bodyBatteryLatest: 45, bodyBatteryMin: 30, bodyBatteryMax: 80, bodyBatteryCharged: 65, bodyBatteryDrained: 30, deepSleepS: 4200, lightSleepS: 12000, remSleepS: 8400, stressLevel: 26 } },
});
assert.match(garminBrief[0], /Garmin Personal API recovery/);
assert.match(garminBrief[1], /morning Body Battery 72/);
assert.match(garminBrief[1], /Body Battery range 30–80, latest 45/);
assert.match(garminBrief[1], /sleep 7h 0m/);
assert.match(garminBrief[1], /resting HR 49 bpm/);
assert.match(garminBrief[1], /weight 80.1 kg \(Garmin\)/);
assert.match(garminBrief[1], /sleep window 00:00–07:00 \(athlete local time\)/);
const staleBrief = formatWellness({ provenance: 'intervals_athlete_wellness', sessionDate: '2026-10-15', sessionDay: { updatedAt: null, sleepDurationS: 100, sleepScore: 1, restingHeartRate: 50, hrv: null, weightKg: null, fitnessCtl: null, fatigueAtl: null, acuteTrainingLoad: null, chronicTrainingLoad: null }, recent: {}, garmin: { provenance: 'garmin_personal_api_wellness', availability: 'stale', lastSuccessfulFetch: '2026-10-15T10:00:00.000Z', failureReason: 'authentication_failed', keyExpiryStatus: 'expired', sessionDay: { sleepDurationS: 200, sleepScore: 2, restingHeartRate: 40 } } });
assert.match(staleBrief.join('\n'), /using stale data/);
assert.match(staleBrief.join('\n'), /key is expired/);
assert.match(garminBrief[1], /fitness CTL 33.0/);

console.log('Coachat brief-segment regression checks passed.');
