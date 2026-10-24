import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { IntervalsCompletedActivitySnapshot } from './intervals-activity-rename';

async function main(): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pacer-activity-rename-'));
  process.env.STORAGE_DIR = tempDir;
  process.env.DATABASE_FILE = path.join(tempDir, 'pacer.sqlite');
  const { importFutureWorkoutProposal } = await import('../workouts/contract');
  const { normalizeIntervalsActivity } = await import('./intervals-source');
  const { planCompletedActivityRename, renameCompletedIntervalsActivity } = await import('./intervals-activity-rename');
  const store = await import('../session/storage');
  store.initSessionStore();
  const proposal = importFutureWorkoutProposal({
    contractVersion: 'future-workout-v1', proposalKey: 'rename-completed-run', proposalRevision: 1, proposedAt: '2026-10-20T00:00:00Z', updatedAt: '2026-10-20T00:00:00Z',
    sourceSession: { sourceActivityId: 1, sessionDate: '2026-10-19' }, schedule: { localDate: '2026-10-20', timezone: 'America/Argentina/Buenos_Aires' },
    workoutType: 'Easy Run', title: 'Easy Run', coachingNotes: '', blocks: [{ kind: 'work', label: 'Run', duration: { unit: 'time', seconds: 1800 }, target: { kind: 'pace', minSecPerKm: 400, maxSecPerKm: 430 } }],
    lifecycle: { approvalStatus: 'proposed', approvedAt: null, approvalNote: null, syncStatus: 'not_requested', syncedAt: null, intervalsEventId: null, lastSyncError: null },
  });
  store.importStoredFutureWorkout(proposal); store.approveStoredFutureWorkout(proposal.pacerWorkoutId); store.finishFutureWorkoutSync(proposal.pacerWorkoutId, '145978255');
  const workouts = store.listStoredFutureWorkouts();
  const input = { activityId: 199414936, plannedWorkoutId: proposal.pacerWorkoutId, expectedActivityTitle: 'Run', notBeforeLocalDate: '2026-10-20' };
  const activity = (): IntervalsCompletedActivitySnapshot => ({ id: 'i199414936', name: 'Run', type: 'Run', start_date_local: '2026-10-20T06:00:00', paired_event_id: 145978255, strava_id: '20658126782', source: 'GARMIN_CONNECT' });

  assert.equal(planCompletedActivityRename(activity(), workouts, input).decision, 'eligible');
  assert.equal(planCompletedActivityRename({ ...activity(), paired_event_id: null }, workouts, input).decision, 'missing_paired_event');
  assert.equal(planCompletedActivityRename({ ...activity(), paired_event_id: 999 }, workouts, input).decision, 'unmatched_paired_event');
  assert.equal(planCompletedActivityRename(activity(), [...workouts, { workout: { ...workouts[0].workout, pacerWorkoutId: 'pacer-fw1-duplicate' } }], input).decision, 'ambiguous_paired_event');
  assert.equal(planCompletedActivityRename({ ...activity(), strava_id: null }, workouts, input).decision, 'missing_strava_link');
  assert.equal(planCompletedActivityRename({ ...activity(), name: 'Saturday with Nico' }, workouts, { ...input, expectedActivityTitle: 'Saturday with Nico' }).decision, 'custom_activity_title');
  assert.equal(planCompletedActivityRename({ ...activity(), name: 'Buenos Aires City - Run' }, workouts, { ...input, expectedActivityTitle: 'Buenos Aires City - Run', allowCustomTitle: true }).decision, 'eligible');
  assert.equal(planCompletedActivityRename({ ...activity(), name: 'Easy Run' }, workouts, { ...input, expectedActivityTitle: 'Easy Run' }).decision, 'already_correct');
  assert.equal(planCompletedActivityRename({ ...activity(), type: 'Ride' }, workouts, input).decision, 'not_running');
  assert.equal(planCompletedActivityRename({ ...activity(), start_date_local: '2026-10-19T06:00:00' }, workouts, input).decision, 'historical_activity');
  assert.equal(normalizeIntervalsActivity({ id: 'i199414936', name: 'Run', type: 'Run', start_date_local: '2026-10-20T06:00:00', paired_event_id: 145978255 })?.pairedEventId, 145978255, 'Intervals pairing survives the normalizer');

  let title = 'Run'; let puts = 0;
  const client = {
    get: async () => ({ ...activity(), name: title }),
    put: async (_id: number, body: { name: string }) => { puts += 1; title = body.name; return { ...activity(), name: title }; },
  };
  const preview = await renameCompletedIntervalsActivity({ ...input, dryRun: true }, workouts, client);
  assert.equal(preview.applied, false); assert.equal(preview.plan.decision, 'eligible'); assert.equal(puts, 0);
  const customPreview = await renameCompletedIntervalsActivity({ ...input, expectedActivityTitle: 'Saturday with Nico', dryRun: true }, workouts, { ...client, get: async () => ({ ...activity(), name: 'Saturday with Nico' }) });
  assert.equal(customPreview.plan.decision, 'custom_activity_title'); assert.equal(puts, 0, 'a refused dry-run makes no PUT');
  const applied = await renameCompletedIntervalsActivity(input, workouts, client);
  assert.equal(applied.applied, true); assert.equal(puts, 1); assert.equal(title, 'Easy Run');
  const repeated = await renameCompletedIntervalsActivity({ ...input, expectedActivityTitle: 'Easy Run' }, workouts, client);
  assert.equal(repeated.applied, false); assert.equal(repeated.plan.decision, 'already_correct'); assert.equal(puts, 1, 'already-correct operation makes no PUT');

  const failedClient = { get: async () => activity(), put: async () => { throw new Error('network unavailable'); } };
  await assert.rejects(() => renameCompletedIntervalsActivity(input, workouts, failedClient), /network unavailable/);
  assert.equal(puts, 1, 'a failed independent operation cannot retry the previous request');
  console.log('Intervals completed-activity rename regression checks passed.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
