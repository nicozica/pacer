import * as assert from 'node:assert/strict';
import { canReplaceFutureWorkout, importFutureWorkoutProposal } from './contract';
import { formatFutureWorkoutPreview } from './preview';

const longRunSteadyFinish = {
  contractVersion: 'future-workout-v1',
  proposalKey: 'long-run-steady-finish',
  proposalRevision: 1,
  proposedAt: '2026-10-18T12:00:00.000Z',
  updatedAt: '2026-10-18T12:00:00.000Z',
  sourceSession: { sourceActivityId: 198651687, sessionDate: '2026-10-18' },
  schedule: { localDate: '2026-10-25', timezone: 'America/Argentina/Buenos_Aires' },
  workoutType: 'Long Run',
  title: 'Long Run + Steady Finish',
  coachingNotes: 'Keep the first hour easy. Let the final block become steady only if the legs stay composed.',
  blocks: [
    { kind: 'warmup', duration: { unit: 'time', seconds: 900 }, target: { kind: 'unrestricted' }, label: 'Settle in' },
    { kind: 'work', duration: { unit: 'time', seconds: 3600 }, target: { kind: 'unrestricted' }, label: 'Aerobic volume' },
    { kind: 'work', duration: { unit: 'time', seconds: 1200 }, target: { kind: 'pace', minSecPerKm: 300, maxSecPerKm: 315 }, label: 'Steady finish' },
    { kind: 'cooldown', duration: { unit: 'time', seconds: 600 }, target: { kind: 'unrestricted' } },
  ],
  lifecycle: {
    approvalStatus: 'proposed', approvedAt: null, approvalNote: null,
    syncStatus: 'not_requested', syncedAt: null, intervalsEventId: null, lastSyncError: null,
  },
};

const imported = importFutureWorkoutProposal(longRunSteadyFinish);
assert.match(imported.pacerWorkoutId, /^pacer-fw1-[a-f0-9]{20}$/);
assert.equal(imported.intervalsEventKey, `pacer:${imported.pacerWorkoutId}`);
assert.equal(importFutureWorkoutProposal(longRunSteadyFinish).pacerWorkoutId, imported.pacerWorkoutId);
assert.match(formatFutureWorkoutPreview(imported).join('\n'), /work: 20:00 @ 5:00 \/km–5:15 \/km — Steady finish/);

const intervalWorkout = importFutureWorkoutProposal({
  ...longRunSteadyFinish,
  proposalKey: 'six-by-one-minute',
  workoutType: 'Interval Session',
  title: '6 × 1 minute',
  blocks: [
    { kind: 'warmup', duration: { unit: 'distance', meters: 2000 }, target: { kind: 'unrestricted' } },
    {
      kind: 'repeat', repetitions: 6, label: 'Controlled reps', steps: [
        { kind: 'work', duration: { unit: 'time', seconds: 60 }, target: { kind: 'pace', minSecPerKm: 250, maxSecPerKm: 260 } },
        { kind: 'recovery', duration: { unit: 'time', seconds: 90 }, target: { kind: 'unrestricted' } },
      ],
    },
    { kind: 'cooldown', duration: { unit: 'distance', meters: 1000 }, target: { kind: 'unrestricted' } },
  ],
});
assert.match(formatFutureWorkoutPreview(intervalWorkout).join('\n'), /Repeat 6× — Controlled reps/);
assert.equal(canReplaceFutureWorkout(imported, { ...imported, proposalRevision: 2 }), true);
assert.equal(canReplaceFutureWorkout(imported, { ...imported, proposalRevision: 1 }), false);
assert.equal(canReplaceFutureWorkout({ ...imported, lifecycle: { ...imported.lifecycle, approvalStatus: 'approved' } }, { ...imported, proposalRevision: 2 }), false);

assert.throws(() => importFutureWorkoutProposal({ ...longRunSteadyFinish, pacerWorkoutId: imported.pacerWorkoutId }), /Pacer-owned/);
assert.throws(() => importFutureWorkoutProposal({ ...longRunSteadyFinish, lifecycle: { ...longRunSteadyFinish.lifecycle, approvalStatus: 'approved' } }), /unapproved/);
assert.throws(() => importFutureWorkoutProposal({ ...longRunSteadyFinish, workoutType: 'Jog' }), /canonical Pacer/);
assert.throws(() => importFutureWorkoutProposal({ ...longRunSteadyFinish, blocks: [] }), /non-empty array/);
assert.throws(() => importFutureWorkoutProposal({ ...longRunSteadyFinish, blocks: [{ kind: 'work', duration: { unit: 'time', seconds: 0 }, target: { kind: 'unrestricted' } }] }), /positive integer/);
assert.throws(() => importFutureWorkoutProposal({ ...longRunSteadyFinish, blocks: [{ kind: 'work', duration: { unit: 'distance', meters: 0 }, target: { kind: 'unrestricted' } }] }), /between 1 and 100000/);
assert.throws(() => importFutureWorkoutProposal({ ...longRunSteadyFinish, blocks: [{ kind: 'work', duration: { unit: 'time', seconds: 60 }, target: { kind: 'pace', minSecPerKm: 300, maxSecPerKm: 290 } }] }), /ordered/);
assert.throws(() => importFutureWorkoutProposal({ ...longRunSteadyFinish, blocks: [{ kind: 'repeat', repetitions: 1, steps: [] }] }), /between 2 and 100/);

console.log('Future workout v1 regression checks passed.');
