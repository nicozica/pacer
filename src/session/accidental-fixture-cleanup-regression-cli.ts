import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

async function main(): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pacer-fixture-cleanup-'));
  process.env.STORAGE_DIR = tempDir;
  process.env.DATABASE_FILE = path.join(tempDir, 'pacer.sqlite');
  const { importFutureWorkoutProposal } = await import('../workouts/contract');
  const store = await import('./storage');
  const { ACCIDENTAL_ACTIVITY_RENAME_FIXTURE_ID, cleanupAccidentalActivityRenameFixture } = await import('./accidental-fixture-cleanup');
  store.initSessionStore();
  const fixture = importFutureWorkoutProposal({ contractVersion:'future-workout-v1', proposalKey:'rename-completed-run', proposalRevision:1, proposedAt:'2026-10-20T00:00:00Z', updatedAt:'2026-10-20T00:00:00Z', sourceSession:{sourceActivityId:1,sessionDate:'2026-10-19'}, schedule:{localDate:'2026-10-20',timezone:'America/Argentina/Buenos_Aires'}, workoutType:'Easy Run', title:'Easy Run', coachingNotes:'', blocks:[{kind:'work',duration:{unit:'time',seconds:60},target:{kind:'unrestricted'}}], lifecycle:{approvalStatus:'proposed',approvedAt:null,approvalNote:null,syncStatus:'not_requested',syncedAt:null,intervalsEventId:null,lastSyncError:null} });
  assert.equal(fixture.pacerWorkoutId, ACCIDENTAL_ACTIVITY_RENAME_FIXTURE_ID);
  store.importStoredFutureWorkout(fixture); store.approveStoredFutureWorkout(fixture.pacerWorkoutId); store.finishFutureWorkoutSync(fixture.pacerWorkoutId, '145978255');
  const { pacerWorkoutId: _fixtureId, intervalsEventKey: _fixtureEventKey, ...fixtureInput } = fixture;
  const legitimate = importFutureWorkoutProposal({ ...fixtureInput, proposalKey:'real-workout', sourceSession:{sourceActivityId:2,sessionDate:'2026-10-19'} });
  store.importStoredFutureWorkout(legitimate); store.approveStoredFutureWorkout(legitimate.pacerWorkoutId); store.finishFutureWorkoutSync(legitimate.pacerWorkoutId, '145978255');
  const Database = require('better-sqlite3'); const db = new Database(process.env.DATABASE_FILE);
  try {
    assert.equal(cleanupAccidentalActivityRenameFixture(db, true).applied, false);
    assert.equal(cleanupAccidentalActivityRenameFixture(db, false).applied, true);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM future_workouts WHERE pacer_workout_id=?').get(fixture.pacerWorkoutId).count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM future_workout_revisions WHERE pacer_workout_id=?').get(fixture.pacerWorkoutId).count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM future_workout_sync_attempts WHERE pacer_workout_id=?').get(fixture.pacerWorkoutId).count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM future_workouts WHERE pacer_workout_id=?').get(legitimate.pacerWorkoutId).count, 1);
  } finally { db.close(); }
  console.log('Accidental fixture cleanup regression checks passed.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
