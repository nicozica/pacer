import * as fs from 'node:fs';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../config';
import type { FutureWorkoutProposal } from '../workouts/types';

function value(args: string[], name: string, required = true): string | null {
  const index = args.indexOf(name); const found = index >= 0 ? args[index + 1] : null;
  if (required && (!found || found.startsWith('--'))) throw new Error(`${name} is required.`);
  return found;
}

function onlyOneMode(args: string[]): 'dry-run' | 'apply' {
  const dryRun = args.includes('--dry-run'); const apply = args.includes('--apply');
  if (dryRun === apply) throw new Error('Specify exactly one of --dry-run or --apply.');
  if (apply && value(args, '--confirm') !== 'APPLY_MAINTENANCE') throw new Error('--apply requires --confirm APPLY_MAINTENANCE.');
  return dryRun ? 'dry-run' : 'apply';
}

function sourceDatabase(): string { return config.databaseFile; }

async function backup(output: string): Promise<void> {
  if (fs.existsSync(output)) throw new Error(`Refusing to overwrite backup ${output}.`);
  fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 }); fs.chmodSync(path.dirname(output), 0o700);
  const source = new Database(sourceDatabase(), { readonly: true, fileMustExist: true });
  try { await source.backup(output); } finally { source.close(); }
  fs.chmodSync(output, 0o600);
  const check = new Database(output, { readonly: true, fileMustExist: true });
  try {
    if (check.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('Backup integrity_check failed.');
    if ((check.pragma('foreign_key_check') as unknown[]).length !== 0) throw new Error('Backup foreign_key_check failed.');
    console.log(JSON.stringify({ backup: output, mode: (fs.statSync(output).mode & 0o777).toString(8), userVersion: check.pragma('user_version', { simple: true }) }, null, 2));
  } finally { check.close(); }
}

function inspectSession(sessionId: number): void {
  const db = new Database(sourceDatabase(), { readonly: true, fileMustExist: true });
  try {
    const row = db.prepare(`SELECT s.id,s.source_activity_id,s.session_date,s.published_at,ai.signal_title,ai.signal_paragraphs_json,ai.carry_forward,(SELECT COUNT(*) FROM session_laps WHERE session_id=s.id) lap_count FROM sessions s JOIN session_ai ai ON ai.session_id=s.id WHERE s.id=?`).get(sessionId);
    if (!row) throw new Error('Session not found.'); console.log(JSON.stringify(row, null, 2));
  } finally { db.close(); }
}

/** Reads only: this maintenance command must not initialize or migrate production SQLite. */
function readFutureWorkoutsReadonly(): Array<{ workout: FutureWorkoutProposal }> {
  const db = new Database(sourceDatabase(), { readonly: true, fileMustExist: true });
  try {
    const rows = db.prepare(`SELECT pacer_workout_id, proposal_json, approval_status, approved_at, approval_note, sync_status, synced_at, intervals_event_id, last_sync_error FROM future_workouts`).all() as Array<Record<string, unknown>>;
    return rows.map((row) => {
      const proposal = JSON.parse(String(row.proposal_json)) as FutureWorkoutProposal;
      return { workout: {
        ...proposal,
        lifecycle: {
          approvalStatus: String(row.approval_status) as FutureWorkoutProposal['lifecycle']['approvalStatus'],
          approvedAt: typeof row.approved_at === 'string' ? row.approved_at : null,
          approvalNote: typeof row.approval_note === 'string' ? row.approval_note : null,
          syncStatus: String(row.sync_status) as FutureWorkoutProposal['lifecycle']['syncStatus'],
          syncedAt: typeof row.synced_at === 'string' ? row.synced_at : null,
          intervalsEventId: typeof row.intervals_event_id === 'string' ? row.intervals_event_id : null,
          lastSyncError: typeof row.last_sync_error === 'string' ? row.last_sync_error : null,
        },
      } };
    });
  } finally { db.close(); }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2); const command = args[0];
  if (command === 'backup') return backup(value(args, '--output')!);
  if (command === 'session-feedback-inspect') return inspectSession(Number(value(args, '--session-id')!));
  if (command === 'intervals-activity-inspect') {
    const { createIntervalsCompletedActivityClient } = await import('../training/intervals-activity-rename');
    const activity = await createIntervalsCompletedActivityClient().get(Number(value(args, '--activity-id')!));
    console.log(JSON.stringify({ id:activity.id, name:activity.name, type:activity.type, start_date_local:activity.start_date_local, paired_event_id:activity.paired_event_id, strava_id:activity.strava_id, source:activity.source }, null, 2));
    return;
  }
  if (command === 'cleanup-accidental-activity-rename-fixture') {
    const mode = onlyOneMode(args);
    if (value(args, '--workout-id') !== 'pacer-fw1-d93ca78bfed0be80798e') throw new Error('This guarded command only permits the known accidental fixture ID.');
    if (mode === 'apply' && value(args, '--confirm') !== 'APPLY_MAINTENANCE') throw new Error('Apply confirmation is required.');
    const { cleanupAccidentalActivityRenameFixture } = await import('./accidental-fixture-cleanup');
    const db = new Database(sourceDatabase(), { fileMustExist: true });
    try { console.log(JSON.stringify({ mode, result: cleanupAccidentalActivityRenameFixture(db, mode === 'dry-run') }, null, 2)); } finally { db.close(); }
    return;
  }
  const mode = onlyOneMode(args);
  if (command === 'workout-rename') {
    const store = await import('./storage');
    const result = store.renameStoredSyncedFutureWorkout({ pacerWorkoutId:value(args,'--workout-id')!,proposalKey:value(args,'--proposal-key')!,expectedTitle:value(args,'--expected-title')!,nextTitle:value(args,'--next-title')!,expectedIntervalsEventId:value(args,'--event-id')!,dryRun:mode==='dry-run' });
    console.log(JSON.stringify({ mode, result }, null, 2)); return;
  }
  if (command === 'intervals-event-rename') {
    const { createIntervalsEventRenameClient, renameIntervalsEvent } = await import('../workouts/intervals-event-rename');
    const result = await renameIntervalsEvent({ eventId:Number(value(args,'--event-id')!),externalId:value(args,'--external-id')!,localDate:value(args,'--local-date')!,expectedTitle:value(args,'--expected-title')!,nextTitle:value(args,'--next-title')!,dryRun:mode==='dry-run' }, createIntervalsEventRenameClient());
    console.log(JSON.stringify({ mode, applied:result.applied, before:{id:result.before.id,name:result.before.name,external_id:result.before.external_id,start_date_local:result.before.start_date_local}, after:result.after && {id:result.after.id,name:result.after.name,external_id:result.after.external_id,start_date_local:result.after.start_date_local} }, null, 2)); return;
  }
  if (command === 'intervals-activity-rename') {
    const { createIntervalsCompletedActivityClient, renameCompletedIntervalsActivity } = await import('../training/intervals-activity-rename');
    const expectedTitle = value(args, '--expected-title')!;
    const allowCustomTitle = args.includes('--allow-custom-title');
    if (allowCustomTitle && value(args, '--confirm-custom-title') !== expectedTitle) throw new Error('--allow-custom-title requires --confirm-custom-title matching --expected-title exactly.');
    if (!allowCustomTitle && args.includes('--confirm-custom-title')) throw new Error('--confirm-custom-title requires --allow-custom-title.');
    const result = await renameCompletedIntervalsActivity({
      activityId:Number(value(args, '--activity-id')!), plannedWorkoutId:value(args, '--workout-id')!, expectedActivityTitle:expectedTitle,
      notBeforeLocalDate:value(args, '--not-before')!, allowCustomTitle, dryRun:mode==='dry-run',
    }, readFutureWorkoutsReadonly(), createIntervalsCompletedActivityClient());
    console.log(JSON.stringify({ mode, applied:result.applied, plan:result.plan, before:{ id:result.before.id, name:result.before.name, type:result.before.type, start_date_local:result.before.start_date_local, paired_event_id:result.before.paired_event_id, strava_id:result.before.strava_id }, after:result.after && { id:result.after.id, name:result.after.name, type:result.after.type, start_date_local:result.after.start_date_local, paired_event_id:result.after.paired_event_id, strava_id:result.after.strava_id } }, null, 2)); return;
  }
  if (command === 'session-feedback') {
    const store = await import('./storage');
    const expected = JSON.parse(fs.readFileSync(value(args,'--expected-feedback-file')!, 'utf8'));
    const next = JSON.parse(fs.readFileSync(value(args,'--next-feedback-file')!, 'utf8'));
    const result = store.updateStoredSessionFeedback({ sessionId:Number(value(args,'--session-id')!),sourceActivityId:Number(value(args,'--source-activity-id')!),sessionDate:value(args,'--session-date')!,expectedLapCount:Number(value(args,'--lap-count')!),expected,next,dryRun:mode==='dry-run' });
    console.log(JSON.stringify({ mode, result }, null, 2)); return;
  }
  if (command === 'session-next-run-title') {
    const store = await import('./storage');
    const result = store.updateStoredSessionNextRunTitle({ sessionId:Number(value(args,'--session-id')!),sourceActivityId:Number(value(args,'--source-activity-id')!),sessionDate:value(args,'--session-date')!,expectedLapCount:Number(value(args,'--lap-count')!),expectedNextRunTitle:value(args,'--expected-title')!,nextRunTitle:value(args,'--next-title')!,dryRun:mode==='dry-run' });
    console.log(JSON.stringify({ mode, result }, null, 2)); return;
  }
  throw new Error('Commands: backup, session-feedback-inspect, intervals-activity-inspect, workout-rename, intervals-event-rename, intervals-activity-rename, session-feedback, session-next-run-title.');
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
