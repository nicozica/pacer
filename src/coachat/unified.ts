import { importFutureWorkoutProposal } from '../workouts/contract';

export const COACHAT_RESPONSE_VERSION = 'coachat-response-v1' as const;

export interface UnifiedCoachatResponse {
  contractVersion: typeof COACHAT_RESPONSE_VERSION;
  sessionAi: Record<string, unknown>;
  futureWorkout: Record<string, unknown>;
}

/** Splits one Coachat response without persisting either domain object. */
export function parseUnifiedCoachatResponse(value: unknown): UnifiedCoachatResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Coachat response must be an object.');
  const raw = value as Record<string, unknown>;
  if (raw.contractVersion !== COACHAT_RESPONSE_VERSION) throw new Error(`contractVersion must be ${COACHAT_RESPONSE_VERSION}.`);
  if (!raw.sessionAi || typeof raw.sessionAi !== 'object' || Array.isArray(raw.sessionAi)) throw new Error('sessionAi must be an object.');
  if (!raw.futureWorkout || typeof raw.futureWorkout !== 'object' || Array.isArray(raw.futureWorkout)) throw new Error('futureWorkout must be an object.');
  // Validate the independently versioned executable half before returning it.
  const sessionAi = raw.sessionAi as Record<string, unknown>;
  const activityId = sessionAi.sourceActivityId;
  const sessionDate = sessionAi.sessionDate;
  if (!Number.isInteger(activityId) || (activityId as number) <= 0) throw new Error('sessionAi.sourceActivityId must be a positive integer.');
  if (typeof sessionDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) throw new Error('sessionAi.sessionDate must use YYYY-MM-DD.');
  const workout = importFutureWorkoutProposal(raw.futureWorkout);
  if (workout.sourceSession.sourceActivityId !== activityId || workout.sourceSession.sessionDate !== sessionDate) {
    throw new Error('sessionAi and futureWorkout must reference the same source activity and session date.');
  }
  return { contractVersion: COACHAT_RESPONSE_VERSION, sessionAi, futureWorkout: raw.futureWorkout as Record<string, unknown> };
}
