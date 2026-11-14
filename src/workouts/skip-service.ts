import {
  createStoredFutureWorkoutSkip,
  getStoredFutureWorkout,
  getStoredFutureWorkoutRemoteCancellation,
  recordStoredFutureWorkoutSkipConflict,
  type StoredFutureWorkout,
  type StoredFutureWorkoutSkip,
} from '../session/storage';
import { getWellnessContextForDate, isRunLike, readActivityBundle, sortActivitiesDesc, type SourceActivity, type SourceWellnessContext } from '../session/source';
import type { GarminWellnessContext } from '../training/garmin-wellness';
import type { FutureWorkoutProposal } from './types';

export interface SkipWorkoutAnchor {
  sourceActivityId: number;
  sessionDate: string;
  title: string;
}

export interface SkipWellnessSnapshot {
  collectedAt: string;
  intervals: Pick<SourceWellnessContext, 'source' | 'provenance' | 'sessionDate' | 'fetchedAt' | 'sessionDay' | 'recent'> | null;
  garmin: Omit<GarminWellnessContext, 'days'> & { days: [] } | null;
  availability: { intervals: 'available' | 'unavailable'; garmin: 'fresh' | 'stale' | 'unavailable' | 'not_enabled' };
}

export interface SkipWorkoutDetails {
  workout: FutureWorkoutProposal;
  eligible: boolean;
  eligibilityReason: string | null;
  skip: StoredFutureWorkoutSkip | null;
  outcomeStatus: 'scheduled' | 'skipped' | 'completed_after_skip';
  completedAfterSkipActivityId: number | null;
  planningAnchor: SkipWorkoutAnchor | null;
  brief: string | null;
  remoteCancellation: ReturnType<typeof getStoredFutureWorkoutRemoteCancellation>;
}

type WellnessProvider = (bundleSource: string | null, sessionDate: string) => Promise<SourceWellnessContext | null>;

function dateOf(activity: SourceActivity): string { return (activity.start_date_local || activity.start_date).slice(0, 10); }

function findPairedActivity(workout: FutureWorkoutProposal, activities: SourceActivity[]): SourceActivity | null {
  if (!workout.lifecycle.intervalsEventId) return null;
  return activities.find((activity) => String(activity.pairedEventId ?? '') === String(workout.lifecycle.intervalsEventId)) ?? null;
}

/** Latest genuine Run known at the decision date; later activities must never revise skip history. */
function findPlanningAnchor(activities: SourceActivity[], cutoffDate: string): SkipWorkoutAnchor | null {
  const activity = sortActivitiesDesc(activities).find((candidate) => isRunLike(candidate)
    && typeof candidate.id === 'number' && dateOf(candidate) <= cutoffDate);
  return activity && typeof activity.id === 'number'
    ? { sourceActivityId: activity.id, sessionDate: dateOf(activity), title: activity.displayActivityName || activity.name }
    : null;
}

function reduceWellness(context: SourceWellnessContext | null, collectedAt: string): SkipWellnessSnapshot {
  const garmin = context?.garmin ?? null;
  return {
    collectedAt,
    intervals: context ? {
      source: context.source, provenance: context.provenance, sessionDate: context.sessionDate,
      fetchedAt: context.fetchedAt, sessionDay: context.sessionDay, recent: context.recent,
    } : null,
    garmin: garmin ? {
      source: garmin.source, provenance: garmin.provenance, availability: garmin.availability,
      sessionDate: garmin.sessionDate, timeZone: garmin.timeZone, fetchedAt: garmin.fetchedAt,
      lastSuccessfulFetch: garmin.lastSuccessfulFetch, failureReason: garmin.failureReason,
      keyExpiryStatus: garmin.keyExpiryStatus, sessionDay: garmin.sessionDay,
      // Retaining no daily series or body-battery samples keeps the skip record focused.
      days: [],
    } : null,
    availability: {
      intervals: context ? 'available' : 'unavailable',
      garmin: garmin?.availability ?? 'not_enabled',
    },
  };
}

function plannedDuration(workout: FutureWorkoutProposal): string {
  const seconds = workout.blocks.reduce((total, block) => {
    if (block.kind === 'repeat') return total + block.steps.reduce((nested, step) => nested + (step.duration.unit === 'time' ? step.duration.seconds * block.repetitions : 0), 0);
    return total + (block.duration.unit === 'time' ? block.duration.seconds : 0);
  }, 0);
  return seconds > 0 ? `${Math.floor(seconds / 60)} minutes planned` : 'structured duration includes distance-based steps';
}

function wellnessLines(snapshot: SkipWellnessSnapshot): string[] {
  const lines = [
    `Recovery data: Intervals ${snapshot.availability.intervals}; Garmin ${snapshot.availability.garmin}.`,
  ];
  const day = snapshot.intervals?.sessionDay;
  if (day) lines.push(`Intervals provenance: ${day.provenance}; updated ${day.updatedAt ?? 'unavailable'}; sleep ${day.sleepDurationS ?? 'unavailable'} s; sleep score ${day.sleepScore ?? 'unavailable'}; resting HR ${day.restingHeartRate ?? 'unavailable'}; HRV ${day.hrv ?? 'unavailable'}.`);
  else lines.push('Intervals session-day recovery indicators: unavailable.');
  const garmin = snapshot.garmin;
  if (garmin?.sessionDay) {
    const sleepStart = garmin.sessionDay.sleepStartLocal ?? garmin.sessionDay.sleepStart;
    const sleepEnd = garmin.sessionDay.sleepEndLocal ?? garmin.sessionDay.sleepEnd;
    lines.push(`Garmin provenance: ${garmin.provenance}; availability ${garmin.availability}; recovery fetched ${garmin.fetchedAt ?? 'unavailable'}; daily data timestamp ${garmin.sessionDay.dataTimestamp ?? 'unavailable'}; sleep ${garmin.sessionDay.sleepDurationS ?? 'unavailable'} s; sleep score ${garmin.sessionDay.sleepScore ?? 'unavailable'}; body battery morning ${garmin.sessionDay.bodyBatteryMorning ?? 'unavailable'}; HRV ${garmin.sessionDay.hrv ?? 'unavailable'}.`);
    lines.push(`Garmin sleep interval: ${sleepStart ?? 'unavailable'} to ${sleepEnd ?? 'unavailable'} (provider-recorded interval; distinct from the recovery fetch time).`);
  }
  else if (garmin) lines.push(`Garmin recovery indicators: ${garmin.availability}; reason ${garmin.failureReason ?? 'not reported'}.`);
  else lines.push('Garmin recovery indicators: not enabled or unavailable.');
  return lines;
}

interface SkipTrainingBriefInput {
  workout: FutureWorkoutProposal;
  planningAnchor: SkipWorkoutAnchor | null;
  explanation: string | null;
  wellnessSnapshot: SkipWellnessSnapshot;
  state: 'intended' | 'persisted';
  skippedAt?: string;
}

function buildSkipTrainingBriefFromInput(input: SkipTrainingBriefInput): string {
  const lines = [
    'SKIP TRAINING BRIEF',
    `Planned workout: ${input.workout.title} (${input.workout.pacerWorkoutId})`,
    `Scheduled date: ${input.workout.schedule.localDate} (${input.workout.schedule.timezone})`,
    `Workout type: ${input.workout.workoutType}; ${plannedDuration(input.workout)}.`,
    input.state === 'persisted'
      ? `Status: skipped intentionally at ${input.skippedAt}; no activity was performed.`
      : 'Status: intended skip pending confirmation. No skip has been persisted and Pacer has not recorded this workout as completed.',
    `Athlete explanation: ${input.explanation ?? 'not provided'}.`,
    `Recovery snapshot collected: ${input.wellnessSnapshot.collectedAt}.`,
    ...wellnessLines(input.wellnessSnapshot),
    input.planningAnchor
      ? `Planning anchor: completed activity ${input.planningAnchor.sourceActivityId} on ${input.planningAnchor.sessionDate} (${input.planningAnchor.title}). This is not the skipped workout.`
      : 'Planning anchor: no genuine completed activity is available; do not fabricate an activity or sourceActivityId.',
    '',
    'For Coachat: provide private coaching feedback in Spanish. Evaluate recovery and training adjustments. Recommend the next appropriate workout without automatically carrying over this skipped session. Return only one standalone valid future-workout-v1 JSON document for Pacer import, using the planning anchor above as sourceSession when it exists. Never fabricate a completed activity or sourceActivityId. Do not return session-ai-v1 or coachat-response-v1.',
  ];
  return lines.join('\n');
}

export function buildSkipTrainingBrief(details: Pick<SkipWorkoutDetails, 'workout' | 'skip' | 'planningAnchor'>): string {
  const skip = details.skip;
  if (!skip) throw new Error('A persisted skip is required to build its brief.');
  return buildSkipTrainingBriefFromInput({
    workout: details.workout,
    planningAnchor: details.planningAnchor,
    explanation: skip.explanation,
    wellnessSnapshot: skip.wellnessSnapshot as SkipWellnessSnapshot,
    state: 'persisted',
    skippedAt: skip.skippedAt,
  });
}

function detailsFor(stored: StoredFutureWorkout, activities: SourceActivity[]): SkipWorkoutDetails {
  let skip = stored.skip;
  const paired = findPairedActivity(stored.workout, activities);
  if (skip && paired && typeof paired.id === 'number') skip = recordStoredFutureWorkoutSkipConflict(stored.workout.pacerWorkoutId, paired.id) ?? skip;
  const eligible = stored.workout.lifecycle.approvalStatus === 'approved'
    && stored.workout.lifecycle.syncStatus !== 'syncing' && !skip && !paired;
  const eligibilityReason = !stored.skip && paired ? 'A completed activity is already paired with this workout.'
    : stored.workout.lifecycle.approvalStatus !== 'approved' ? 'Only approved workouts can be skipped.'
      : stored.workout.lifecycle.syncStatus === 'syncing' ? 'A workout being synchronized cannot be skipped.'
        : skip ? 'This workout has already been skipped.' : null;
  // A persisted skip is historical evidence. Never replace its anchor with a newer activity.
  const anchor = skip ? skip.planningAnchor : findPlanningAnchor(activities, stored.workout.schedule.localDate);
  return {
    workout: stored.workout, eligible, eligibilityReason, skip,
    outcomeStatus: skip?.conflictActivityId ? 'completed_after_skip' : skip ? 'skipped' : 'scheduled',
    completedAfterSkipActivityId: skip?.conflictActivityId ?? null,
    planningAnchor: anchor,
    brief: skip ? buildSkipTrainingBrief({ workout: stored.workout, skip, planningAnchor: anchor }) : null,
    remoteCancellation: getStoredFutureWorkoutRemoteCancellation(stored.workout.pacerWorkoutId),
  };
}

function activitiesAndSource(): { activities: SourceActivity[]; source: string | null } {
  const bundle = readActivityBundle();
  return { activities: bundle?.activities ?? [], source: bundle?.source ?? null };
}

export interface SkipWorkoutPreview extends SkipWorkoutDetails {
  /** This distinguishes a non-mutating intention from a stored skip. */
  skipIntentStatus: 'intended_skip_not_persisted' | 'persisted_skip';
  recoveryPreview: SkipWellnessSnapshot;
}

export async function getSkipWorkoutPreview(pacerWorkoutId: string, explanation: string | null = null, wellnessProvider: WellnessProvider = getWellnessContextForDate): Promise<SkipWorkoutPreview> {
  const stored = getStoredFutureWorkout(pacerWorkoutId);
  if (!stored) throw new Error('Future workout not found.');
  const { activities, source } = activitiesAndSource();
  const collectedAt = new Date().toISOString();
  let wellness: SourceWellnessContext | null = null;
  try { wellness = await wellnessProvider(source, stored.workout.schedule.localDate); } catch { wellness = null; }
  const recoveryPreview = reduceWellness(wellness, collectedAt);
  const details = detailsFor(stored, activities);
  if (details.skip) return { ...details, skipIntentStatus: 'persisted_skip', recoveryPreview };
  // A preview is a present decision aid, so its anchor is the latest genuine run known now.
  // The POST endpoint independently persists its own anchor at final confirmation.
  const planningAnchor = findPlanningAnchor(activities, collectedAt.slice(0, 10));
  return {
    ...details,
    planningAnchor,
    skipIntentStatus: 'intended_skip_not_persisted',
    brief: buildSkipTrainingBriefFromInput({
      workout: details.workout,
      planningAnchor,
      explanation: explanation?.trim() || null,
      wellnessSnapshot: recoveryPreview,
      state: 'intended',
    }),
    recoveryPreview,
  };
}

export async function skipWorkout(pacerWorkoutId: string, explanation: string | null, wellnessProvider: WellnessProvider = getWellnessContextForDate): Promise<{ operation: 'created' | 'unchanged'; details: SkipWorkoutDetails }> {
  const stored = getStoredFutureWorkout(pacerWorkoutId);
  if (!stored) throw new Error('Future workout not found.');
  const { activities, source } = activitiesAndSource();
  const before = detailsFor(stored, activities);
  if (!before.eligible && !before.skip) throw new Error(before.eligibilityReason ?? 'Workout cannot be skipped.');
  if (before.skip) return { operation: 'unchanged', details: before };
  const collectedAt = new Date().toISOString();
  let wellness: SourceWellnessContext | null = null;
  try { wellness = await wellnessProvider(source, stored.workout.schedule.localDate); } catch { wellness = null; }
  const snapshot = reduceWellness(wellness, collectedAt);
  const planningAnchor = findPlanningAnchor(activities, collectedAt.slice(0, 10));
  const created = createStoredFutureWorkoutSkip({
    pacerWorkoutId,
    skippedAt: collectedAt,
    explanation: explanation?.trim() || null,
    wellnessSnapshot: snapshot,
    wellnessCollectedAt: collectedAt,
    wellnessProvenance: snapshot.availability,
    planningAnchor,
  });
  const reloaded = getStoredFutureWorkout(pacerWorkoutId);
  if (!reloaded) throw new Error('Could not reload skipped workout.');
  return { operation: created.operation, details: detailsFor(reloaded, activities) };
}

export function getSkipWorkoutDetails(pacerWorkoutId: string): SkipWorkoutDetails {
  const stored = getStoredFutureWorkout(pacerWorkoutId);
  if (!stored) throw new Error('Future workout not found.');
  return detailsFor(stored, activitiesAndSource().activities);
}
