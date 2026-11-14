import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { IntervalsCalendarClient } from './intervals-calendar';

async function main(): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pacer-remote-cancellation-'));
  process.env.STORAGE_DIR = tempDir;
  process.env.DATABASE_FILE = path.join(tempDir, 'pacer.sqlite');
  const store = await import('../session/storage');
  const { importFutureWorkoutProposal } = await import('./contract');
  const { toIntervalsCalendarEvent } = await import('./intervals-calendar');
  const { cancelSkippedWorkoutRemotely } = await import('./remote-cancellation-service');
  store.initSessionStore();

  const raw = (key: string, date = '2026-11-14') => ({
    contractVersion: 'future-workout-v1', proposalKey: key, proposalRevision: 1,
    proposedAt: '2026-11-13T00:00:00Z', updatedAt: '2026-11-13T00:00:00Z',
    sourceSession: { sourceActivityId: 99, sessionDate: '2026-11-10' },
    schedule: { localDate: date, timezone: 'America/Argentina/Buenos_Aires' }, workoutType: 'Long Run', title: key,
    coachingNotes: '', blocks: [{ kind: 'work', duration: { unit: 'time', seconds: 4800 }, target: { kind: 'unrestricted' } }],
    lifecycle: { approvalStatus: 'proposed', approvedAt: null, approvalNote: null, syncStatus: 'not_requested', syncedAt: null, intervalsEventId: null, lastSyncError: null },
  });
  const addSkipped = (key: string, eventId: string, date?: string) => {
    const proposal = importFutureWorkoutProposal(raw(key, date));
    store.importStoredFutureWorkout(proposal); store.approveStoredFutureWorkout(proposal.pacerWorkoutId); store.finishFutureWorkoutSync(proposal.pacerWorkoutId, eventId);
    store.createStoredFutureWorkoutSkip({ pacerWorkoutId: proposal.pacerWorkoutId, skippedAt: '2026-11-14T12:00:00Z', explanation: 'Rest', wellnessSnapshot: { availability: { intervals: 'unavailable', garmin: 'not_enabled' }, intervals: null, garmin: null }, wellnessCollectedAt: '2026-11-14T12:00:00Z', wellnessProvenance: {}, planningAnchor: null });
    return store.getStoredFutureWorkout(proposal.pacerWorkoutId)!;
  };
  const primary = addSkipped('remote-primary', '501');
  const eventFor = (stored: typeof primary, overrides: Record<string, unknown> = {}) => ({ ...toIntervalsCalendarEvent(stored.workout), id: Number(stored.workout.lifecycle.intervalsEventId), workout_doc: { steps: [{}] }, ...overrides });
  let deletes = 0;
  const goodClient: IntervalsCalendarClient = { findByExternalId: async () => eventFor(primary), upsert: async () => { throw new Error('not used'); }, deleteById: async (id) => { deletes += 1; assert.equal(id, '501'); } };
  const first = await cancelSkippedWorkoutRemotely(primary.workout.pacerWorkoutId, goodClient);
  assert.equal(first.operation, 'deleted'); assert.equal(first.cancellation.status, 'deleted'); assert.equal(first.garmin.status, 'not_attempted_unverified'); assert.equal(deletes, 1);
  assert.equal(store.getStoredFutureWorkout(primary.workout.pacerWorkoutId)?.skip?.explanation, 'Rest', 'skip history remains intact');
  assert.equal(store.getStoredFutureWorkoutPublication(primary.workout.pacerWorkoutId), null, 'cancellation never publishes a public Next Run');
  const duplicate = await cancelSkippedWorkoutRemotely(primary.workout.pacerWorkoutId, goodClient);
  assert.equal(duplicate.operation, 'unchanged'); assert.equal(deletes, 1, 'completed deletion is never repeated');

  const replacement = importFutureWorkoutProposal(raw('replacement', '2026-11-17'));
  store.importStoredFutureWorkout(replacement); store.approveStoredFutureWorkout(replacement.pacerWorkoutId); store.finishFutureWorkoutSync(replacement.pacerWorkoutId, '777');
  assert.equal(store.getStoredFutureWorkout(replacement.pacerWorkoutId)?.workout.lifecycle.intervalsEventId, '777', 'replacement remains untouched');
  assert.equal(store.getStoredFutureWorkoutPublication(replacement.pacerWorkoutId), null, 'replacement is not published by cancellation');

  const absent = addSkipped('remote-absent', '502');
  const absentResult = await cancelSkippedWorkoutRemotely(absent.workout.pacerWorkoutId, { findByExternalId: async () => null, upsert: async () => { throw new Error('not used'); }, deleteById: async () => { throw new Error('must not delete'); } });
  assert.equal(absentResult.operation, 'already_absent'); assert.equal(absentResult.cancellation.status, 'already_absent');

  const wrongIdentity = addSkipped('remote-wrong-identity', '503');
  await assert.rejects(() => cancelSkippedWorkoutRemotely(wrongIdentity.workout.pacerWorkoutId, { findByExternalId: async () => eventFor(wrongIdentity, { external_id: 'not-pacer' }), upsert: async () => { throw new Error('not used'); }, deleteById: async () => { throw new Error('must not delete'); } }), /does not match/);
  assert.equal(store.getStoredFutureWorkoutRemoteCancellation(wrongIdentity.workout.pacerWorkoutId)?.status, 'failed');

  const wrongEventId = addSkipped('remote-wrong-id', '504');
  await assert.rejects(() => cancelSkippedWorkoutRemotely(wrongEventId.workout.pacerWorkoutId, { findByExternalId: async () => eventFor(wrongEventId, { id: 999 }), upsert: async () => { throw new Error('not used'); }, deleteById: async () => { throw new Error('must not delete'); } }), /does not match/);

  const failed = addSkipped('remote-failed', '505');
  let attempts = 0;
  const retryClient: IntervalsCalendarClient = { findByExternalId: async () => eventFor(failed), upsert: async () => { throw new Error('not used'); }, deleteById: async () => { attempts += 1; if (attempts === 1) throw new Error('Intervals calendar deletion failed (503).'); } };
  await assert.rejects(() => cancelSkippedWorkoutRemotely(failed.workout.pacerWorkoutId, retryClient), /503/);
  assert.equal(store.getStoredFutureWorkoutRemoteCancellation(failed.workout.pacerWorkoutId)?.status, 'failed');
  assert.equal((await cancelSkippedWorkoutRemotely(failed.workout.pacerWorkoutId, retryClient)).operation, 'deleted'); assert.equal(attempts, 2);

  const missing = importFutureWorkoutProposal(raw('missing-event'));
  store.importStoredFutureWorkout(missing); store.approveStoredFutureWorkout(missing.pacerWorkoutId);
  store.createStoredFutureWorkoutSkip({ pacerWorkoutId: missing.pacerWorkoutId, skippedAt: '2026-11-14T12:00:00Z', explanation: null, wellnessSnapshot: { availability: { intervals: 'unavailable', garmin: 'not_enabled' }, intervals: null, garmin: null }, wellnessCollectedAt: '2026-11-14T12:00:00Z', wellnessProvenance: {}, planningAnchor: null });
  await assert.rejects(() => cancelSkippedWorkoutRemotely(missing.pacerWorkoutId, goodClient), /no stored Intervals event ID/);

  const paired = addSkipped('remote-paired', '506');
  store.recordStoredFutureWorkoutSkipConflict(paired.workout.pacerWorkoutId, 12345);
  await assert.rejects(() => cancelSkippedWorkoutRemotely(paired.workout.pacerWorkoutId, goodClient), /completed activity/);

  const concurrent = addSkipped('remote-concurrent', '507');
  let concurrentDeletes = 0;
  const concurrentClient: IntervalsCalendarClient = { findByExternalId: async () => eventFor(concurrent), upsert: async () => { throw new Error('not used'); }, deleteById: async () => { concurrentDeletes += 1; await Promise.resolve(); } };
  await Promise.all([cancelSkippedWorkoutRemotely(concurrent.workout.pacerWorkoutId, concurrentClient), cancelSkippedWorkoutRemotely(concurrent.workout.pacerWorkoutId, concurrentClient)]);
  assert.equal(concurrentDeletes, 1, 'duplicate requests share one remote deletion');
  console.log('Remote cancellation regression checks passed.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
