import {
  getStoredFutureWorkout,
  getStoredFutureWorkoutRemoteCancellation,
  recordStoredFutureWorkoutRemoteCancellation,
  type StoredFutureWorkoutRemoteCancellation,
} from '../session/storage';
import { createIntervalsCalendarClient, toIntervalsCalendarEvent, validateIntervalsCalendarIdentity, type IntervalsCalendarClient } from './intervals-calendar';
import { getSkipWorkoutDetails } from './skip-service';

export interface RemoteCancellationResult {
  operation: 'deleted' | 'already_absent' | 'unchanged';
  cancellation: StoredFutureWorkoutRemoteCancellation;
  /** Pacer does not call Garmin here and cannot attest to downstream deletion. */
  garmin: { status: 'not_attempted_unverified' };
}

const remoteCancellationInFlight = new Map<string, Promise<RemoteCancellationResult>>();

/**
 * Removes only a Pacer-owned, still-planned Intervals event. This is deliberately
 * separate from recording a skip: a remote failure must never affect local history.
 */
export async function cancelSkippedWorkoutRemotely(
  pacerWorkoutId: string,
  client: IntervalsCalendarClient = createIntervalsCalendarClient(),
): Promise<RemoteCancellationResult> {
  const inFlight = remoteCancellationInFlight.get(pacerWorkoutId);
  if (inFlight) return inFlight;
  const operation = cancelSkippedWorkoutRemotelyOnce(pacerWorkoutId, client);
  remoteCancellationInFlight.set(pacerWorkoutId, operation);
  try { return await operation; } finally { remoteCancellationInFlight.delete(pacerWorkoutId); }
}

async function cancelSkippedWorkoutRemotelyOnce(
  pacerWorkoutId: string,
  client: IntervalsCalendarClient,
): Promise<RemoteCancellationResult> {
  const stored = getStoredFutureWorkout(pacerWorkoutId);
  if (!stored) throw new Error('Future workout not found.');
  const details = getSkipWorkoutDetails(pacerWorkoutId);
  if (!details.skip) throw new Error('Only skipped workouts can have their remote event cancelled.');
  if (details.outcomeStatus === 'completed_after_skip') throw new Error('A workout paired with a completed activity cannot have its remote event cancelled.');
  const intervalsEventId = stored.workout.lifecycle.intervalsEventId;
  if (!intervalsEventId) throw new Error('The skipped workout has no stored Intervals event ID.');
  const expected = toIntervalsCalendarEvent(stored.workout);
  const prior = getStoredFutureWorkoutRemoteCancellation(pacerWorkoutId);
  if (prior && (prior.status === 'deleted' || prior.status === 'already_absent')) {
    return { operation: 'unchanged', cancellation: prior, garmin: { status: 'not_attempted_unverified' } };
  }
  if (!client.deleteById) throw new Error('Intervals calendar deletion is not configured.');
  try {
    const remote = await client.findByExternalId(expected.external_id, stored.workout.schedule.localDate);
    if (!remote) {
      const cancellation = recordStoredFutureWorkoutRemoteCancellation({
        pacerWorkoutId, intervalsEventId, externalId: expected.external_id, status: 'already_absent', error: null,
      });
      return { operation: 'already_absent', cancellation, garmin: { status: 'not_attempted_unverified' } };
    }
    validateIntervalsCalendarIdentity(remote, expected);
    if (String(remote.id) !== intervalsEventId) throw new Error('Intervals event ID does not match the Pacer synchronization record.');
    await client.deleteById(intervalsEventId);
    const cancellation = recordStoredFutureWorkoutRemoteCancellation({
      pacerWorkoutId, intervalsEventId, externalId: expected.external_id, status: 'deleted', error: null,
    });
    return { operation: 'deleted', cancellation, garmin: { status: 'not_attempted_unverified' } };
  } catch (error) {
    recordStoredFutureWorkoutRemoteCancellation({
      pacerWorkoutId, intervalsEventId, externalId: expected.external_id, status: 'failed', error: (error as Error).message,
    });
    throw error;
  }
}
