import { beginFutureWorkoutSync, failFutureWorkoutSync, finishFutureWorkoutSync, getStoredFutureWorkout, hasConflictingSyncedFutureWorkout } from '../session/storage';
import { createIntervalsCalendarClient, toIntervalsCalendarEvent, validateIntervalsCalendarResponse, type IntervalsCalendarClient } from './intervals-calendar';

export async function syncFutureWorkout(id: string, client: IntervalsCalendarClient = createIntervalsCalendarClient()) {
  let stored = beginFutureWorkoutSync(id);
  if (stored.workout.lifecycle.syncStatus === 'synced') return stored;
  try {
    if (hasConflictingSyncedFutureWorkout(stored.workout)) throw new Error('Rescheduling a synced workout requires an explicit supersede action.');
    const expected = toIntervalsCalendarEvent(stored.workout);
    const existing = await client.findByExternalId(expected.external_id, stored.workout.schedule.localDate);
    const remote = existing ?? await client.upsert(expected);
    validateIntervalsCalendarResponse(remote, expected);
    return finishFutureWorkoutSync(id, String(remote.id));
  } catch (error) {
    return failFutureWorkoutSync(id, (error as Error).message);
  }
}
