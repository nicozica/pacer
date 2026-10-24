import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const parsedFixture = require('./fixtures/intervals-structured-run.fixture.json');

function baseProposal(): Record<string, unknown> {
  return {
    contractVersion: 'future-workout-v1', proposalKey: 'step-cue-regression', proposalRevision: 1,
    proposedAt: '2026-10-23T00:00:00Z', updatedAt: '2026-10-23T00:00:00Z',
    sourceSession: { sourceActivityId: 198651687, sessionDate: '2026-10-18' },
    schedule: { localDate: '2026-11-01', timezone: 'America/Argentina/Buenos_Aires' },
    workoutType: 'Interval Session', title: '2 × 1 km', coachingNotes: '',
    blocks: [
      { kind: 'warmup', label: 'Warm up', duration: { unit: 'time', seconds: 600 }, target: { kind: 'pace', minSecPerKm: 420, maxSecPerKm: 420 } },
      { kind: 'repeat', repetitions: 2, label: 'Controlled reps', steps: [
        { kind: 'work', label: 'Run', duration: { unit: 'distance', meters: 1000 }, target: { kind: 'pace', minSecPerKm: 250, maxSecPerKm: 260 } },
        { kind: 'recovery', label: 'Recover', duration: { unit: 'time', seconds: 120 }, target: { kind: 'pace', minSecPerKm: 330, maxSecPerKm: 360 } },
      ] },
      { kind: 'cooldown', label: 'Cool down', duration: { unit: 'time', seconds: 600 }, target: { kind: 'unrestricted' } },
    ],
    lifecycle: { approvalStatus: 'proposed', approvedAt: null, approvalNote: null, syncStatus: 'not_requested', syncedAt: null, intervalsEventId: null, lastSyncError: null },
  };
}

async function main(): Promise<void> {
  // Set isolation before importing any module that reaches runtime config/storage.
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pacer-step-cue-'));
  process.env.STORAGE_DIR = tempDir;
  process.env.DATABASE_FILE = path.join(tempDir, 'pacer.sqlite');
  process.env.CMS_EXPORT_DIR = path.join(tempDir, 'cms');
  const { importFutureWorkoutProposal } = await import('./contract');
  const { intervalsWorkoutDescription } = await import('./intervals-calendar');
  const uncuedFixture = importFutureWorkoutProposal({
    ...baseProposal(), proposalKey: 'calendar-test', schedule: { localDate: '2026-10-25', timezone: 'America/Argentina/Buenos_Aires' },
    blocks: [
      { kind: 'warmup', label: 'Warm up', duration: { unit: 'time', seconds: 600 }, target: { kind: 'pace', minSecPerKm: 420, maxSecPerKm: 440 } },
      { kind: 'repeat', repetitions: 2, label: 'Controlled reps', steps: [
        { kind: 'work', label: 'Fast', duration: { unit: 'distance', meters: 1000 }, target: { kind: 'pace', minSecPerKm: 250, maxSecPerKm: 260 } },
        { kind: 'recovery', label: 'Jog recover', duration: { unit: 'time', seconds: 120 }, target: { kind: 'pace', minSecPerKm: 330, maxSecPerKm: 360 } },
      ] },
      { kind: 'cooldown', label: 'Cool down', duration: { unit: 'time', seconds: 600 }, target: { kind: 'unrestricted' } },
    ],
  });
  assert.equal(intervalsWorkoutDescription(uncuedFixture), parsedFixture.description, 'uncued workouts must be byte-for-byte unchanged');

  const raw = baseProposal() as any;
  raw.blocks[0].cue = 'Settle in gently';
  raw.blocks[1].steps[0].cue = 'Smooth and controlled';
  raw.blocks[1].steps[1].cue = 'Easy breathing';
  raw.blocks[2].cue = 'Relax the shoulders';
  const cued = importFutureWorkoutProposal(raw);
  const description = intervalsWorkoutDescription(cued);
  assert.equal(description, [
    '- Warm up: Settle in gently 10m 7:00/km Pace intensity=warmup', '', 'Controlled reps 2x',
    '- Run: Smooth and controlled 1km 4:10-4:20/km Pace intensity=active',
    '- Recover: Easy breathing 2m 5:30-6:00/km Pace intensity=recovery', '',
    '- Cool down: Relax the shoulders 10m intensity=cooldown',
  ].join('\n'));
  assert.deepEqual(cued.blocks[0], { kind: 'warmup', label: 'Warm up', cue: 'Settle in gently', duration: { unit: 'time', seconds: 600 }, target: { kind: 'pace', minSecPerKm: 420, maxSecPerKm: 420 } });
  const repeat = cued.blocks[1] as any;
  assert.equal(repeat.repetitions, 2);
  assert.deepEqual(repeat.steps.map((step: any) => ({ text: `${step.label}: ${step.cue}`, intensity: step.kind === 'work' ? 'active' : step.kind, duration: step.duration, target: step.target })), [
    { text: 'Run: Smooth and controlled', intensity: 'active', duration: { unit: 'distance', meters: 1000 }, target: { kind: 'pace', minSecPerKm: 250, maxSecPerKm: 260 } },
    { text: 'Recover: Easy breathing', intensity: 'recovery', duration: { unit: 'time', seconds: 120 }, target: { kind: 'pace', minSecPerKm: 330, maxSecPerKm: 360 } },
  ]);

  for (const cue of ['two\nlines', 'intensity=active', 'pace/km', '(parenthetical)']) {
    const invalid = baseProposal() as any;
    invalid.blocks[0].cue = cue;
    assert.throws(() => importFutureWorkoutProposal(invalid), /blocks\[0\]\.cue/);
  }

  assert.equal(importFutureWorkoutProposal(baseProposal()).pacerWorkoutId, cued.pacerWorkoutId, 'cues must not change deterministic workout identity');
  const store = await import('../session/storage');
  const { syncFutureWorkout } = await import('./sync-service');
  store.initSessionStore();
  store.importStoredFutureWorkout(cued);
  assert.equal(store.getStoredFutureWorkout(cued.pacerWorkoutId)?.workout.blocks[1].kind, 'repeat');
  assert.equal((store.getStoredFutureWorkout(cued.pacerWorkoutId)?.workout.blocks[1] as any).steps[0].cue, 'Smooth and controlled');
  store.approveStoredFutureWorkout(cued.pacerWorkoutId);
  let creates = 0;
  const client = {
    findByExternalId: async () => null,
    upsert: async (event: any) => {
      creates += 1;
      assert.equal(event.description, description);
      return { ...event, id: 991, workout_doc: { steps: [{ text: 'fixture' }] } };
    },
  };
  const synced = await syncFutureWorkout(cued.pacerWorkoutId, client);
  assert.equal(synced.workout.lifecycle.intervalsEventId, '991');
  await syncFutureWorkout(cued.pacerWorkoutId, client);
  assert.equal(creates, 1, 'a synced workout must not cause a duplicate calendar update');
  const changedCue = importFutureWorkoutProposal({ ...raw, proposalRevision: 2, updatedAt: '2026-10-23T00:01:00Z', blocks: raw.blocks.map((block: any) => ({ ...block })) });
  assert.throws(() => store.importStoredFutureWorkout(changedCue), /approved or synchronized/);

  console.log('Per-step coaching cue regression checks passed.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
