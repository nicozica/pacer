import { config } from '../config';
import type { FutureWorkoutProposal } from '../workouts/types';

/** The small subset required for a name-only completed-activity update. */
export interface IntervalsCompletedActivitySnapshot {
  id: string | number;
  name: string;
  type: string;
  start_date_local: string;
  paired_event_id?: string | number | null;
  strava_id?: string | number | null;
  source?: string | null;
  [key: string]: unknown;
}

export interface IntervalsCompletedActivityClient {
  get(activityId: number): Promise<IntervalsCompletedActivitySnapshot>;
  put(activityId: number, body: { name: string }): Promise<IntervalsCompletedActivitySnapshot>;
}

export interface StoredPlannedWorkoutForActivityRename {
  workout: FutureWorkoutProposal;
}

export type ActivityRenameDecision =
  | 'eligible'
  | 'already_correct'
  | 'activity_not_found'
  | 'not_running'
  | 'historical_activity'
  | 'missing_paired_event'
  | 'unmatched_paired_event'
  | 'ambiguous_paired_event'
  | 'planned_workout_not_synced'
  | 'paired_event_mismatch'
  | 'missing_strava_link'
  | 'expected_activity_title_mismatch'
  | 'custom_activity_title';

export interface CompletedActivityRenamePlan {
  decision: ActivityRenameDecision;
  eligible: boolean;
  activityId: number | null;
  plannedWorkoutId: string | null;
  existingTitle: string | null;
  proposedTitle: string | null;
  stravaActivityId: string | null;
  reason: string;
}

export interface CompletedActivityRenameInput {
  activityId: number;
  plannedWorkoutId: string;
  expectedActivityTitle: string;
  /** Explicit cut-over date. This is required so a one-off cannot rename old activity history. */
  notBeforeLocalDate: string;
  /** Manual, selected-activity exception only; never supplied by automated execution. */
  allowCustomTitle?: boolean;
  dryRun?: boolean;
}

const RUN_TYPES = new Set(['run', 'trailrun', 'virtualrun']);
const GENERIC_RUN_TITLES = new Set(['run', 'running', 'morning run', 'afternoon run', 'evening run', 'night run', 'lunch run']);
const DEMONSTRATED_GENERATED_CITY_PREFIX = 'Buenos Aires City - ';

function numericId(value: unknown): number | null {
  const text = typeof value === 'string' ? value.trim().replace(/^i/i, '') : value;
  const number = typeof text === 'number' ? text : Number(text);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function localDate(value: string): string | null {
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}

function normalizedSport(value: string): string {
  return value.replace(/[\s_-]+/g, '').toLowerCase();
}

function plan(decision: ActivityRenameDecision, activity: IntervalsCompletedActivitySnapshot | null, workout: FutureWorkoutProposal | null, reason: string): CompletedActivityRenamePlan {
  return {
    decision,
    eligible: decision === 'eligible',
    activityId: activity ? numericId(activity.id) : null,
    plannedWorkoutId: workout?.pacerWorkoutId ?? null,
    existingTitle: activity?.name ?? null,
    proposedTitle: workout?.title ?? null,
    stravaActivityId: activity?.strava_id === undefined || activity?.strava_id === null || String(activity.strava_id).trim() === '' ? null : String(activity.strava_id),
    reason,
  };
}

/**
 * Deliberately requires Intervals' paired_event_id. Dates are only a historical
 * guard; they are never used to associate an activity with a workout.
 */
export function planCompletedActivityRename(
  activity: IntervalsCompletedActivitySnapshot | null,
  workouts: StoredPlannedWorkoutForActivityRename[],
  input: CompletedActivityRenameInput,
): CompletedActivityRenamePlan {
  if (!activity || numericId(activity.id) !== input.activityId) return plan('activity_not_found', null, null, 'The fetched activity does not match the selected activity ID.');
  const selected = workouts.filter(({ workout }) => workout.pacerWorkoutId === input.plannedWorkoutId);
  if (selected.length !== 1) return plan('missing_paired_event', activity, null, 'The selected stored Pacer workout was not found exactly once.');
  const workout = selected[0].workout;
  if (!RUN_TYPES.has(normalizedSport(activity.type))) return plan('not_running', activity, workout, 'Only completed running activities are eligible.');
  const date = localDate(activity.start_date_local);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(input.notBeforeLocalDate) || date < input.notBeforeLocalDate) {
    return plan('historical_activity', activity, workout, 'The activity predates the explicit naming cut-over date.');
  }
  if (workout.lifecycle.approvalStatus !== 'approved' || workout.lifecycle.syncStatus !== 'synced' || !workout.lifecycle.intervalsEventId) {
    return plan('planned_workout_not_synced', activity, workout, 'The selected Pacer workout is not an approved, synced calendar workout.');
  }
  const pairedEventId = numericId(activity.paired_event_id);
  if (!pairedEventId) return plan('missing_paired_event', activity, workout, 'Intervals did not provide paired_event_id; date-only matching is prohibited.');
  const paired = workouts.filter(({ workout: candidate }) => Number(candidate.lifecycle.intervalsEventId) === pairedEventId);
  if (paired.length === 0) return plan('unmatched_paired_event', activity, workout, 'paired_event_id does not match a stored Pacer workout.');
  if (paired.length > 1) return plan('ambiguous_paired_event', activity, workout, 'paired_event_id identifies more than one stored Pacer workout.');
  if (String(workout.lifecycle.intervalsEventId) !== String(pairedEventId)) return plan('paired_event_mismatch', activity, workout, 'The selected Pacer workout does not own the activity paired_event_id.');
  if (activity.strava_id === undefined || activity.strava_id === null || String(activity.strava_id).trim() === '') {
    return plan('missing_strava_link', activity, workout, 'Intervals does not expose a linked Strava activity ID, so duplicate safety cannot be established.');
  }
  if (activity.name !== input.expectedActivityTitle) return plan('expected_activity_title_mismatch', activity, workout, 'The activity title no longer matches the explicit expected current title.');
  if (activity.name === workout.title) return plan('already_correct', activity, workout, 'The activity already has the exact planned workout title.');
  const genericTitle = GENERIC_RUN_TITLES.has(activity.name.trim().toLowerCase());
  const exactDemonstratedCityTitle = activity.name === `${DEMONSTRATED_GENERATED_CITY_PREFIX}${workout.title}`;
  if (!genericTitle && !exactDemonstratedCityTitle && !input.allowCustomTitle) {
    return plan('custom_activity_title', activity, workout, 'The current title is not a known generic running title, so its origin is uncertain.');
  }
  return plan('eligible', activity, workout, input.allowCustomTitle
    ? 'A manually confirmed exact-title override is scoped to this paired running activity.'
    : exactDemonstratedCityTitle
      ? 'The title exactly matches the demonstrated generated city-prefix pattern for this Pacer workout.'
      : 'paired_event_id uniquely matches the approved, synced Pacer workout and the title is generic.');
}

function authHeader(): string {
  if (!config.intervalsApiKey) throw new Error('INTERVALS_API_KEY is required for Intervals activity maintenance.');
  return `Basic ${Buffer.from(`API_KEY:${config.intervalsApiKey}`).toString('base64')}`;
}

/** No retries: a caller must explicitly authorize each selected activity update. */
export function createIntervalsCompletedActivityClient(fetchImpl: typeof fetch = fetch): IntervalsCompletedActivityClient {
  const activityUrl = (activityId: number) => `${config.intervalsApiBaseUrl.replace(/\/$/, '')}/activity/i${activityId}`;
  const parse = async (response: Response, action: string): Promise<IntervalsCompletedActivitySnapshot> => {
    if (!response.ok) throw new Error(`Intervals completed-activity ${action} failed (${response.status}).`);
    const body = await response.json() as unknown;
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(`Intervals completed-activity ${action} returned an invalid response.`);
    return body as IntervalsCompletedActivitySnapshot;
  };
  return {
    get: async (activityId) => parse(await fetchImpl(activityUrl(activityId), { headers: { Authorization: authHeader(), Accept: 'application/json' } }), 'GET'),
    put: async (activityId, body) => parse(await fetchImpl(activityUrl(activityId), { method: 'PUT', headers: { Authorization: authHeader(), Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), 'PUT'),
  };
}

export async function renameCompletedIntervalsActivity(
  input: CompletedActivityRenameInput,
  workouts: StoredPlannedWorkoutForActivityRename[],
  client: IntervalsCompletedActivityClient,
): Promise<{ applied: boolean; before: IntervalsCompletedActivitySnapshot; after: IntervalsCompletedActivitySnapshot | null; plan: CompletedActivityRenamePlan }> {
  const before = await client.get(input.activityId);
  const beforePlan = planCompletedActivityRename(before, workouts, input);
  if (beforePlan.decision === 'already_correct') return { applied: false, before, after: null, plan: beforePlan };
  if (input.dryRun) return { applied: false, before, after: null, plan: beforePlan };
  if (!beforePlan.eligible) throw new Error(`Completed activity rename refused: ${beforePlan.reason}`);
  const response = await client.put(input.activityId, { name: beforePlan.proposedTitle! });
  if (numericId(response.id) !== input.activityId || response.name !== beforePlan.proposedTitle) throw new Error('Intervals completed-activity PUT returned an unexpected identity or title.');
  const after = await client.get(input.activityId);
  if (numericId(after.id) !== input.activityId || after.name !== beforePlan.proposedTitle || after.type !== before.type || after.start_date_local !== before.start_date_local || numericId(after.paired_event_id) !== numericId(before.paired_event_id) || String(after.strava_id ?? '') !== String(before.strava_id ?? '')) {
    throw new Error('Completed activity rename verification failed after the single PUT.');
  }
  return { applied: true, before, after, plan: beforePlan };
}
