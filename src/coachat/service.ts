import { parseUnifiedCoachatResponse } from './unified';
import { importFutureWorkoutProposal } from '../workouts/contract';
import { formatFutureWorkoutPreview } from '../workouts/preview';

/** Validation-only: never saves a session or proposal, and never approves/syncs. */
export function validateUnifiedCoachatImport(value: unknown) {
  const envelope = parseUnifiedCoachatResponse(value);
  const workout = importFutureWorkoutProposal(envelope.futureWorkout);
  return { contractVersion: envelope.contractVersion, sessionAi: envelope.sessionAi, futureWorkout: envelope.futureWorkout, preview: formatFutureWorkoutPreview(workout) };
}
