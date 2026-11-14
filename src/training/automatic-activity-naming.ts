import * as fs from 'node:fs';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../config';
import type { SourceActivity } from '../session/source';
import type { FutureWorkoutProposal } from '../workouts/types';
import {
  createIntervalsCompletedActivityClient,
  planCompletedActivityRename,
  planNullPairedEventActivityRename,
  renameCompletedIntervalsActivity,
  type IntervalsCompletedActivityClient,
  type IntervalsCompletedActivitySnapshot,
  type StoredPlannedWorkoutForActivityRename,
} from './intervals-activity-rename';

/** Explicit production cutover; automatic naming never considers earlier activities. */
export const AUTOMATIC_ACTIVITY_NAMING_NOT_BEFORE = '2026-10-23';
/** The null-pair fallback is newer and must never backfill activities before this date. */
export const NULL_PAIR_FALLBACK_NOT_BEFORE = '2026-10-26';
const activeActivityIds = new Set<number>();

interface NamingState { failedActivityIds: number[]; }
export type AutomaticNamingOutcome = 'renamed' | 'already_correct' | 'skipped' | 'failed';

function activityDate(activity: SourceActivity): string | null {
  const value = activity.start_date_local || activity.start_date;
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}

function isRun(activity: SourceActivity): boolean {
  return ['run', 'trailrun', 'virtualrun'].includes((activity.sport_type || activity.type || '').replace(/[\s_-]+/g, '').toLowerCase());
}

function stateFile(): string { return path.join(config.storageDir, 'json', 'activity-naming-outcomes.json'); }

function readState(): NamingState {
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile(), 'utf8')) as Partial<NamingState>;
    return { failedActivityIds: Array.isArray(parsed.failedActivityIds) ? parsed.failedActivityIds.filter(Number.isSafeInteger) : [] };
  } catch { return { failedActivityIds: [] }; }
}

function writeState(state: NamingState): void {
  fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
  fs.writeFileSync(stateFile(), JSON.stringify(state, null, 2), { mode: 0o600 });
}

/** Read-only lookup; unlike session storage this never initializes or migrates SQLite. */
function readSyncedFutureWorkouts(): StoredPlannedWorkoutForActivityRename[] {
  const db = new Database(config.databaseFile, { readonly: true, fileMustExist: true });
  try {
    return (db.prepare(`SELECT fw.proposal_json, fw.approval_status, fw.approved_at, fw.approval_note, fw.sync_status, fw.synced_at, fw.intervals_event_id, fw.last_sync_error,
      EXISTS(SELECT 1 FROM future_workout_skips s WHERE s.pacer_workout_id=fw.pacer_workout_id) AS skipped
      FROM future_workouts fw WHERE fw.approval_status='approved' AND fw.sync_status='synced'`).all() as Array<Record<string, unknown>>).map((row) => {
      const proposal = JSON.parse(String(row.proposal_json)) as FutureWorkoutProposal;
      return { workout: { ...proposal, lifecycle: {
        approvalStatus: String(row.approval_status) as FutureWorkoutProposal['lifecycle']['approvalStatus'],
        approvedAt: typeof row.approved_at === 'string' ? row.approved_at : null,
        approvalNote: typeof row.approval_note === 'string' ? row.approval_note : null,
        syncStatus: String(row.sync_status) as FutureWorkoutProposal['lifecycle']['syncStatus'],
        syncedAt: typeof row.synced_at === 'string' ? row.synced_at : null,
        intervalsEventId: typeof row.intervals_event_id === 'string' ? row.intervals_event_id : null,
        lastSyncError: typeof row.last_sync_error === 'string' ? row.last_sync_error : null,
      } }, skipped: Number(row.skipped) === 1 };
    });
  } finally { db.close(); }
}

export async function processAutomaticActivityNaming(
  activities: SourceActivity[],
  workouts: StoredPlannedWorkoutForActivityRename[],
  client: IntervalsCompletedActivityClient,
  failedActivityIds: Set<number>,
): Promise<Array<{ activityId: number; outcome: AutomaticNamingOutcome; reason: string }>> {
  const outcomes: Array<{ activityId: number; outcome: AutomaticNamingOutcome; reason: string }> = [];
  for (const activity of activities) {
    const activityId = activity.sourceActivityId ?? activity.id;
    const date = activityDate(activity);
    if (typeof activityId !== 'number' || !isRun(activity) || !date || date < AUTOMATIC_ACTIVITY_NAMING_NOT_BEFORE) continue;
    if (failedActivityIds.has(activityId) || activeActivityIds.has(activityId)) { outcomes.push({ activityId, outcome: 'skipped', reason: 'previous failure or concurrent attempt' }); continue; }
    activeActivityIds.add(activityId);
    try {
      const snapshot = await client.get(activityId);
      const activeWorkouts = workouts.filter(({ skipped }) => !skipped);
      const candidates = activeWorkouts.filter(({ workout }) => String(workout.lifecycle.intervalsEventId) === String(snapshot.paired_event_id));
      const pairedSelected = candidates.length === 1 ? candidates[0].workout : null;
      const fallbackCandidates = snapshot.paired_event_id === null && date >= NULL_PAIR_FALLBACK_NOT_BEFORE
        ? activeWorkouts.filter(({ workout }) => workout.schedule.localDate === date
          && workout.lifecycle.approvalStatus === 'approved' && workout.lifecycle.syncStatus === 'synced' && Boolean(workout.lifecycle.intervalsEventId))
        : [];
      const fallbackSelected = fallbackCandidates.length === 1 ? fallbackCandidates[0].workout : null;
      const selected = pairedSelected ?? fallbackSelected;
      const input = selected ? {
        activityId, plannedWorkoutId: selected.pacerWorkoutId, expectedActivityTitle: snapshot.name,
        notBeforeLocalDate: pairedSelected ? AUTOMATIC_ACTIVITY_NAMING_NOT_BEFORE : NULL_PAIR_FALLBACK_NOT_BEFORE,
        ...(pairedSelected ? {} : { nullPairFallbackActivities: activities }),
      } : null;
      const plan = input
        ? pairedSelected
          ? planCompletedActivityRename(snapshot, activeWorkouts, input)
          : planNullPairedEventActivityRename(snapshot, activeWorkouts, input, activities)
        : null;
      if (!plan || !input) { outcomes.push({ activityId, outcome: 'skipped', reason: snapshot.paired_event_id === null && date < NULL_PAIR_FALLBACK_NOT_BEFORE ? `null paired_event_id fallback starts on ${NULL_PAIR_FALLBACK_NOT_BEFORE}` : snapshot.paired_event_id === null ? 'null paired_event_id fallback has no unique approved, synced Pacer workout on this date' : 'paired_event_id is missing, unmatched, or ambiguous' }); continue; }
      if (plan.decision === 'already_correct') { outcomes.push({ activityId, outcome: 'already_correct', reason: plan.reason }); continue; }
      if (!plan.eligible) { outcomes.push({ activityId, outcome: 'skipped', reason: plan.reason }); continue; }
      await renameCompletedIntervalsActivity(input, activeWorkouts, client);
      outcomes.push({ activityId, outcome: 'renamed', reason: plan.reason });
    } catch (error) {
      failedActivityIds.add(activityId);
      outcomes.push({ activityId, outcome: 'failed', reason: error instanceof Error ? error.message : 'unknown error' });
    } finally { activeActivityIds.delete(activityId); }
  }
  return outcomes;
}

/** Best-effort post-fetch integration; all errors are contained so normal fetching succeeds. */
export async function autoNameFetchedIntervalsActivities(activities: SourceActivity[]): Promise<void> {
  try {
    const state = readState(); const failed = new Set(state.failedActivityIds);
    const outcomes = await processAutomaticActivityNaming(activities, readSyncedFutureWorkouts(), createIntervalsCompletedActivityClient(), failed);
    const newlyFailed = [...failed].filter((id) => !state.failedActivityIds.includes(id));
    if (newlyFailed.length > 0) writeState({ failedActivityIds: [...new Set([...state.failedActivityIds, ...newlyFailed])] });
    for (const result of outcomes) console.log(`Activity naming ${result.outcome}: ${result.activityId} (${result.reason})`);
  } catch (error) {
    console.error(`Activity naming skipped: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
}
