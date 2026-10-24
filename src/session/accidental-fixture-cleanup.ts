import type Database from 'better-sqlite3';

export const ACCIDENTAL_ACTIVITY_RENAME_FIXTURE_ID = 'pacer-fw1-d93ca78bfed0be80798e';
const FIXTURE_PROPOSAL_KEY = 'rename-completed-run';

export interface AccidentalFixtureInspection {
  workoutId: string;
  proposalKey: string;
  revisions: number;
  syncAttempts: number;
}

function inspect(db: Database.Database): AccidentalFixtureInspection {
  const row = db.prepare('SELECT pacer_workout_id, proposal_key, source_activity_id, source_session_date, scheduled_local_date, title, intervals_event_id FROM future_workouts WHERE pacer_workout_id=?').get(ACCIDENTAL_ACTIVITY_RENAME_FIXTURE_ID) as Record<string, unknown> | undefined;
  if (!row) throw new Error('Accidental fixture was not found.');
  if (row.proposal_key !== FIXTURE_PROPOSAL_KEY || row.source_activity_id !== 1 || row.source_session_date !== '2026-10-19' || row.scheduled_local_date !== '2026-10-20' || row.title !== 'Easy Run' || row.intervals_event_id !== '145978255') {
    throw new Error('Refusing cleanup: the selected record does not exactly match the accidental fixture fingerprint.');
  }
  const revisions = Number((db.prepare('SELECT COUNT(*) AS count FROM future_workout_revisions WHERE pacer_workout_id=?').get(ACCIDENTAL_ACTIVITY_RENAME_FIXTURE_ID) as { count: number }).count);
  const syncAttempts = Number((db.prepare('SELECT COUNT(*) AS count FROM future_workout_sync_attempts WHERE pacer_workout_id=?').get(ACCIDENTAL_ACTIVITY_RENAME_FIXTURE_ID) as { count: number }).count);
  if (revisions !== 2 || syncAttempts !== 1) throw new Error('Refusing cleanup: the fixture dependencies differ from the known accidental test fixture.');
  const unrelated = Number((db.prepare('SELECT COUNT(*) AS count FROM future_workouts WHERE intervals_event_id=? AND pacer_workout_id<>?').get('145978255', ACCIDENTAL_ACTIVITY_RENAME_FIXTURE_ID) as { count: number }).count);
  if (unrelated !== 1) throw new Error('Refusing cleanup: expected exactly one legitimate workout sharing event 145978255.');
  return { workoutId: String(row.pacer_workout_id), proposalKey: String(row.proposal_key), revisions, syncAttempts };
}

export function cleanupAccidentalActivityRenameFixture(db: Database.Database, dryRun: boolean): { applied: boolean; inspection: AccidentalFixtureInspection } {
  const inspection = inspect(db);
  if (dryRun) return { applied: false, inspection };
  const operation = db.transaction(() => {
    db.pragma('foreign_keys = ON');
    if (db.prepare('DELETE FROM future_workouts WHERE pacer_workout_id=?').run(ACCIDENTAL_ACTIVITY_RENAME_FIXTURE_ID).changes !== 1) throw new Error('Fixture cleanup did not delete exactly one future workout.');
    const revisions = Number((db.prepare('SELECT COUNT(*) AS count FROM future_workout_revisions WHERE pacer_workout_id=?').get(ACCIDENTAL_ACTIVITY_RENAME_FIXTURE_ID) as { count: number }).count);
    const attempts = Number((db.prepare('SELECT COUNT(*) AS count FROM future_workout_sync_attempts WHERE pacer_workout_id=?').get(ACCIDENTAL_ACTIVITY_RENAME_FIXTURE_ID) as { count: number }).count);
    if (revisions !== 0 || attempts !== 0) throw new Error('Fixture cleanup cascade verification failed.');
    if ((db.pragma('foreign_key_check') as unknown[]).length !== 0) throw new Error('Fixture cleanup foreign-key verification failed.');
  });
  operation();
  return { applied: true, inspection };
}
