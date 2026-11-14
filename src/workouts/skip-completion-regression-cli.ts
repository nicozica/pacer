import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { PublishStatus } from '../session/types';

const now = '2026-11-14T10:00:00Z';
const publishStatus = (ok: boolean): PublishStatus => ({ ok, snapshotsOk: true, buildOk: ok, deployOk: ok, verifyOk: ok, originVerified: ok, publicVerified: ok, originInconclusive: false, timedOut: false, locked: false, exitCode: ok ? 0 : 1, signal: null, logFile: null, deployTarget: null, expectedSessionPath: null, publicUrl: null, message: ok ? 'verified' : 'build failed', outputTail: [] });

async function main(): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pacer-skip-completion-'));
  process.env.STORAGE_DIR = tempDir; process.env.DATABASE_FILE = path.join(tempDir, 'db', 'pacer.sqlite'); process.env.CMS_EXPORT_DIR = path.join(tempDir, 'cms');
  const store = await import('../session/storage');
  const { importFutureWorkoutProposal } = await import('./contract');
  const { skipWorkout } = await import('./skip-service');
  const { syncFutureWorkout } = await import('./sync-service');
  const service = await import('./service');
  store.initSessionStore();
  const Database = (await import('better-sqlite3')).default;
  const db = new Database(process.env.DATABASE_FILE!);
  db.prepare("INSERT INTO sessions (session_date, title, sport, source, source_activity_id, distance_m, moving_time_s, created_at, updated_at, published_at) VALUES ('2026-11-12','Completed Run','Run','test',99,10000,3600,?,?,?)").run(now, now, now); db.close();
  const raw = (key: string, date: string, title: string) => ({ contractVersion: 'future-workout-v1', proposalKey: key, proposalRevision: 1, proposedAt: now, updatedAt: now, sourceSession: { sourceActivityId: 99, sessionDate: '2026-11-12' }, schedule: { localDate: date, timezone: 'America/Argentina/Buenos_Aires' }, workoutType: 'Easy Run', title, coachingNotes: 'private coaching material must never be public', blocks: [{ kind: 'warmup', duration: { unit: 'time', seconds: 600 }, target: { kind: 'unrestricted' } }, { kind: 'work', duration: { unit: 'time', seconds: 2400 }, target: { kind: 'pace', minSecPerKm: 330, maxSecPerKm: 360 } }, { kind: 'cooldown', duration: { unit: 'time', seconds: 600 }, target: { kind: 'unrestricted' } }], lifecycle: { approvalStatus: 'proposed', approvedAt: null, approvalNote: null, syncStatus: 'not_requested', syncedAt: null, intervalsEventId: null, lastSyncError: null } });
  const createTarget = (key: string, date: string) => {
    const proposal = importFutureWorkoutProposal(raw(key, date, `Skipped ${key}`));
    store.importStoredFutureWorkout(proposal); store.approveStoredFutureWorkout(proposal.pacerWorkoutId); store.finishFutureWorkoutSync(proposal.pacerWorkoutId, `target-${key}`);
    return proposal.pacerWorkoutId;
  };
  const skip = (id: string, input: unknown) => skipWorkout(id, typeof (input as { explanation?: unknown }).explanation === 'string' ? (input as { explanation: string }).explanation : null, async () => null);
  let remoteUpserts = 0; let deploys = 0; let cancellationCalls = 0;
  const cancellation = (operation: 'deleted' | 'already_absent' | 'unchanged', id: string) => ({ operation, cancellation: { pacerWorkoutId: id, intervalsEventId: `target-${id}`, externalId: `pacer:${id}`, status: operation === 'unchanged' ? 'deleted' : operation, attemptedAt: now, error: null }, garmin: { status: 'not_attempted_unverified' as const } });
  const successfulDependencies = {
    skip, cancelRemote: async (id: string) => { cancellationCalls += 1; return cancellation(cancellationCalls === 1 ? 'deleted' : 'unchanged', id); }, importWorkout: service.importFutureWorkout, approve: service.approveFutureWorkout,
    synchronize: async (id: string) => service.getFutureWorkout((await syncFutureWorkout(id, { findByExternalId: async () => null, upsert: async (event: any) => { remoteUpserts += 1; return { ...event, id: remoteUpserts, workout_doc: { steps: [{}] } }; } } as any)).workout.pacerWorkoutId)!,
    publishNextRun: (id: string) => service.publishFutureWorkoutAsPublicNextRun(id, async () => { deploys += 1; return publishStatus(true); }),
  };
  const skippedId = createTarget('first-skip', '2099-01-01'); const replacement = raw('replacement', '2099-01-02', 'Easy Aerobic Reset');
  fs.mkdirSync(process.env.CMS_EXPORT_DIR!, { recursive: true }); fs.writeFileSync(path.join(process.env.CMS_EXPORT_DIR!, 'latest-session.json'), '{"unchanged":true}');
  const first = await service.completeSkippedWorkout(skippedId, { explanation: 'private', futureWorkout: replacement, publishNextRun: true }, successfulDependencies);
  assert.equal(first.complete, true); assert.equal(first.remoteCancellation.operation, 'deleted'); assert.equal(remoteUpserts, 1); assert.equal(deploys, 1); assert.equal(first.imported.operation, 'created');
  const publicSnapshot = fs.readFileSync(path.join(process.env.CMS_EXPORT_DIR!, 'next-run.json'), 'utf8');
  assert.match(publicSnapshot, /Easy Aerobic Reset/); assert.doesNotMatch(publicSnapshot, /2099|scheduled|private|skip|wellness|coaching material/i); assert.equal(fs.readFileSync(path.join(process.env.CMS_EXPORT_DIR!, 'latest-session.json'), 'utf8'), '{"unchanged":true}');
  const verifyDb = new Database(process.env.DATABASE_FILE!); assert.equal((verifyDb.prepare('SELECT COUNT(*) AS count FROM sessions').get() as { count: number }).count, 1, 'public Next Run refresh must not fabricate a completed activity'); verifyDb.close();
  const repeat = await service.completeSkippedWorkout(skippedId, { explanation: 'private', futureWorkout: replacement, publishNextRun: true }, successfulDependencies);
  assert.equal(repeat.complete, true); assert.equal(repeat.remoteCancellation.operation, 'unchanged'); assert.equal(repeat.imported.operation, 'unchanged'); assert.equal(remoteUpserts, 1, 'synced replacements are not sent remotely again'); assert.equal(deploys, 1, 'successful public publication is not deployed again');
  assert.equal(store.getStoredFutureWorkoutSkip(skippedId)?.explanation, 'private');
  await assert.rejects(() => service.completeSkippedWorkout(skippedId, { futureWorkout: { ...replacement, title: 'Conflict' } }, successfulDependencies), /conflicts with the stored revision/);

  const syncFailureId = createTarget('sync-failure', '2098-02-01'); const syncReplacement = raw('sync-replacement', '2098-02-02', 'Sync retry');
  const failingSyncDependencies = { ...successfulDependencies, synchronize: async (id: string) => service.getFutureWorkout((await syncFutureWorkout(id, { findByExternalId: async () => null, upsert: async () => { throw new Error('offline'); } } as any)).workout.pacerWorkoutId)! };
  const syncFailure = await service.completeSkippedWorkout(syncFailureId, { futureWorkout: syncReplacement }, failingSyncDependencies);
  assert.equal(syncFailure.stage, 'sync'); assert.equal(syncFailure.imported.operation, 'created');
  const syncResume = await service.completeSkippedWorkout(syncFailureId, { futureWorkout: syncReplacement }, successfulDependencies);
  assert.equal(syncResume.complete, true); assert.equal(syncResume.imported.operation, 'unchanged');

  const publishFailureId = createTarget('publish-failure', '2097-03-01'); const publishReplacement = raw('publish-replacement', '2097-03-02', 'Publish retry');
  const failingPublishDependencies = { ...successfulDependencies, publishNextRun: (id: string) => service.publishFutureWorkoutAsPublicNextRun(id, async () => { deploys += 1; return publishStatus(false); }) };
  const publishFailure = await service.completeSkippedWorkout(publishFailureId, { futureWorkout: publishReplacement, publishNextRun: true }, failingPublishDependencies);
  assert.equal(publishFailure.stage, 'publish');
  const publishResume = await service.completeSkippedWorkout(publishFailureId, { futureWorkout: publishReplacement, publishNextRun: true }, successfulDependencies);
  assert.equal(publishResume.complete, true); assert.equal(publishResume.imported.operation, 'unchanged');

  // A cancellation outage is recorded but must never hold up the replacement or public publication.
  const cancellationFailureId = createTarget('cancellation-failure', '2096-04-01'); const cancellationReplacement = raw('cancellation-replacement', '2096-04-02', 'Cancellation retry');
  let cancellationAttempts = 0;
  const failedCancellationDependencies = {
    ...successfulDependencies,
    cancelRemote: async (id: string) => {
      cancellationAttempts += 1;
      if (cancellationAttempts === 1) {
        store.recordStoredFutureWorkoutRemoteCancellation({ pacerWorkoutId: id, intervalsEventId: `target-cancellation-failure`, externalId: `pacer:${id}`, status: 'failed', error: 'Intervals calendar deletion failed (503).' });
        throw new Error('Intervals calendar deletion failed (503).');
      }
      store.recordStoredFutureWorkoutRemoteCancellation({ pacerWorkoutId: id, intervalsEventId: `target-cancellation-failure`, externalId: `pacer:${id}`, status: 'deleted', error: null });
      return cancellation('deleted', id);
    },
  };
  const cancellationFailure = await service.completeSkippedWorkout(cancellationFailureId, { futureWorkout: cancellationReplacement, publishNextRun: true }, failedCancellationDependencies);
  assert.equal(cancellationFailure.complete, true, 'cancellation failure does not block sync or publish');
  assert.equal(cancellationFailure.remoteCancellation.operation, 'failed');
  assert.equal(store.getStoredFutureWorkoutRemoteCancellation(cancellationFailureId)?.status, 'failed');
  const cancellationRetry = await service.completeSkippedWorkout(cancellationFailureId, { futureWorkout: cancellationReplacement, publishNextRun: true }, failedCancellationDependencies);
  assert.equal(cancellationRetry.complete, true); assert.equal(cancellationRetry.remoteCancellation.operation, 'deleted');
  assert.equal(remoteUpserts, 4, 'retrying cancellation does not duplicate replacement sync');
  assert.equal(deploys, 4, 'retrying cancellation does not duplicate public publication');
  console.log('Skip completion and public Next Run regression checks passed.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
