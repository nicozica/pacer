import * as assert from 'node:assert/strict';
import { getPlannedWorkoutSessionTypeSuggestion } from './service';
import type { SourceActivity } from './source';
import type { StoredFutureWorkout } from './storage';

const activity = (overrides: Partial<SourceActivity> = {}): SourceActivity => ({
  id: 211141602,
  name: 'Easy Aerobic Reset',
  rawActivityName: 'Easy Aerobic Reset',
  displayActivityName: 'Easy Aerobic Reset',
  distance: 7075,
  moving_time: 2931,
  total_elevation_gain: 0,
  type: 'Run',
  sport_type: 'Run',
  start_date: '2026-11-17T09:12:27Z',
  start_date_local: '2026-11-17T06:12:27',
  average_speed: 2.41,
  pairedEventId: null,
  ...overrides,
});

const workout = (overrides: Record<string, unknown> = {}): StoredFutureWorkout => ({
  workout: {
    pacerWorkoutId: 'pacer-fw1-easy-reset',
    title: 'Easy Aerobic Reset',
    workoutType: 'Easy Run',
    schedule: { localDate: '2026-11-17', timezone: 'America/Argentina/Buenos_Aires' },
    lifecycle: { approvalStatus: 'approved', syncStatus: 'synced', intervalsEventId: '155791277' },
    ...overrides,
  },
  createdAt: '2026-11-14T00:00:00Z', storedAt: '2026-11-14T00:00:00Z', revisions: [], skip: null,
} as unknown as StoredFutureWorkout);

const completed = activity();
assert.equal(
  getPlannedWorkoutSessionTypeSuggestion(completed, [completed], [workout()]),
  'Easy Run',
  'a uniquely matched, exact-title unpaired completion receives its planned canonical type without being saved',
);
assert.equal(
  getPlannedWorkoutSessionTypeSuggestion(activity({ pairedEventId: 155791277, name: 'Run', rawActivityName: 'Run', displayActivityName: 'Run' }), [completed], [workout()]),
  'Easy Run',
  'a verified Intervals pairing is authoritative even when the completed title is generic',
);
assert.equal(
  getPlannedWorkoutSessionTypeSuggestion(activity({ name: 'Personal Run', rawActivityName: 'Personal Run', displayActivityName: 'Personal Run' }), [completed], [workout()]),
  null,
  'a null-pair fallback never reclassifies a non-matching title',
);
assert.equal(
  getPlannedWorkoutSessionTypeSuggestion(completed, [completed, activity({ id: 211141603 })], [workout()]),
  null,
  'a null-pair fallback requires exactly one completed run on the date',
);
assert.equal(
  getPlannedWorkoutSessionTypeSuggestion(completed, [completed], [{ ...workout(), skip: {} as StoredFutureWorkout['skip'] }]),
  null,
  'skipped workouts can never prefill a completed activity',
);

console.log('Planned session-type prefill regression checks passed.');
