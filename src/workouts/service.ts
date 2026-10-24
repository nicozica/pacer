import {
  FutureWorkoutImportResult,
  StoredFutureWorkout,
  approveStoredFutureWorkout,
  getStoredFutureWorkout,
  importStoredFutureWorkout,
  listStoredFutureWorkouts,
} from '../session/storage';
import { importFutureWorkoutProposal } from './contract';
import { formatFutureWorkoutPreview } from './preview';
import { syncFutureWorkout } from './sync-service';

export interface FutureWorkoutApiRecord {
  workout: StoredFutureWorkout['workout'];
  createdAt: string;
  storedAt: string;
  revisions: StoredFutureWorkout['revisions'];
  preview: string[];
}

function toApiRecord(stored: StoredFutureWorkout): FutureWorkoutApiRecord {
  return {
    workout: stored.workout,
    createdAt: stored.createdAt,
    storedAt: stored.storedAt,
    revisions: stored.revisions,
    preview: formatFutureWorkoutPreview(stored.workout),
  };
}

export function importFutureWorkout(value: unknown): { operation: FutureWorkoutImportResult['operation']; proposal: FutureWorkoutApiRecord } {
  const result = importStoredFutureWorkout(importFutureWorkoutProposal(value));
  return { operation: result.operation, proposal: toApiRecord(result.stored) };
}

export function listFutureWorkouts(): FutureWorkoutApiRecord[] {
  return listStoredFutureWorkouts().map(toApiRecord);
}

export function getFutureWorkout(pacerWorkoutId: string): FutureWorkoutApiRecord | null {
  const stored = getStoredFutureWorkout(pacerWorkoutId);
  return stored ? toApiRecord(stored) : null;
}

export function approveFutureWorkout(pacerWorkoutId: string, input: unknown): FutureWorkoutApiRecord {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input as { approvalNote?: unknown } : {};
  if (raw.approvalNote !== undefined && raw.approvalNote !== null && typeof raw.approvalNote !== 'string') {
    throw new Error('approvalNote must be a string or null.');
  }
  const approvalNote = typeof raw.approvalNote === 'string' && raw.approvalNote.trim() ? raw.approvalNote.trim() : null;
  return toApiRecord(approveStoredFutureWorkout(pacerWorkoutId, approvalNote));
}
export async function synchronizeFutureWorkout(pacerWorkoutId: string): Promise<FutureWorkoutApiRecord> {
  return toApiRecord(await syncFutureWorkout(pacerWorkoutId));
}
