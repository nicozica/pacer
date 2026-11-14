import {
  FutureWorkoutImportResult,
  StoredFutureWorkout,
  approveStoredFutureWorkout,
  getStoredFutureWorkout,
  getStoredFutureWorkoutRemoteCancellation,
  getStoredFutureWorkoutPublication,
  importStoredFutureWorkout,
  listStoredFutureWorkouts,
  recordStoredFutureWorkoutPublication,
} from '../session/storage';
import { importFutureWorkoutProposal } from './contract';
import { formatFutureWorkoutPreview } from './preview';
import { syncFutureWorkout } from './sync-service';
import { getSkipWorkoutDetails, getSkipWorkoutPreview, skipWorkout, type SkipWorkoutDetails } from './skip-service';
import { refreshPublicNextRunSnapshot } from '../session/service';
import { deployRunSite } from '../session/deploy';
import type { PublishStatus } from '../session/types';
import { cancelSkippedWorkoutRemotely } from './remote-cancellation-service';
import type { StoredFutureWorkoutRemoteCancellation } from '../session/storage';

export interface FutureWorkoutApiRecord {
  workout: StoredFutureWorkout['workout'];
  createdAt: string;
  storedAt: string;
  revisions: StoredFutureWorkout['revisions'];
  preview: string[];
  skip: SkipWorkoutDetails['skip'];
  outcomeStatus: SkipWorkoutDetails['outcomeStatus'];
  completedAfterSkipActivityId: number | null;
}

function toApiRecord(stored: StoredFutureWorkout): FutureWorkoutApiRecord {
  return {
    workout: stored.workout,
    createdAt: stored.createdAt,
    storedAt: stored.storedAt,
    revisions: stored.revisions,
    preview: formatFutureWorkoutPreview(stored.workout),
    skip: stored.skip,
    outcomeStatus: stored.skip?.conflictActivityId ? 'completed_after_skip' : stored.skip ? 'skipped' : 'scheduled',
    completedAfterSkipActivityId: stored.skip?.conflictActivityId ?? null,
  };
}

export function importFutureWorkout(value: unknown): { operation: FutureWorkoutImportResult['operation']; proposal: FutureWorkoutApiRecord } {
  const result = importStoredFutureWorkout(importFutureWorkoutProposal(value));
  return { operation: result.operation, proposal: toApiRecord(result.stored) };
}

/** Lifecycle changes are Pacer-owned after import; every other proposal field must remain identical. */
function sameImportedWorkout(existing: StoredFutureWorkout['workout'], incoming: StoredFutureWorkout['workout']): boolean {
  const withoutLifecycle = ({ lifecycle: _lifecycle, ...proposal }: StoredFutureWorkout['workout']) => proposal;
  return existing.pacerWorkoutId === incoming.pacerWorkoutId
    && existing.proposalRevision === incoming.proposalRevision
    && JSON.stringify(withoutLifecycle(existing)) === JSON.stringify(withoutLifecycle(incoming));
}

function importFutureWorkoutForCompletion(value: unknown): { operation: FutureWorkoutImportResult['operation']; proposal: FutureWorkoutApiRecord } {
  const incoming = importFutureWorkoutProposal(value);
  const existing = getStoredFutureWorkout(incoming.pacerWorkoutId);
  if (existing && sameImportedWorkout(existing.workout, incoming)) {
    return { operation: 'unchanged', proposal: toApiRecord(existing) };
  }
  const result = importStoredFutureWorkout(incoming);
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

export { getSkipWorkoutDetails, getSkipWorkoutPreview };
export { cancelSkippedWorkoutRemotely };

function skipExplanation(input: unknown): string | null {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input as { explanation?: unknown } : {};
  if (raw.explanation !== undefined && raw.explanation !== null && typeof raw.explanation !== 'string') {
    throw new Error('explanation must be a string or null.');
  }
  if (typeof raw.explanation === 'string' && raw.explanation.length > 2_000) throw new Error('explanation must be at most 2000 characters.');
  return typeof raw.explanation === 'string' ? raw.explanation : null;
}

/** Generates an intended-skip brief without writing a skip record. */
export async function previewFutureWorkoutSkip(pacerWorkoutId: string, input: unknown) {
  return getSkipWorkoutPreview(pacerWorkoutId, skipExplanation(input));
}

export async function markFutureWorkoutSkipped(pacerWorkoutId: string, input: unknown) {
  return skipWorkout(pacerWorkoutId, skipExplanation(input));
}

function previouslyPublishedStatus(message: string): PublishStatus {
  return { ok: true, snapshotsOk: true, buildOk: true, deployOk: true, verifyOk: true, originVerified: true, publicVerified: true, originInconclusive: false, timedOut: false, locked: false, exitCode: 0, signal: null, logFile: null, deployTarget: null, expectedSessionPath: null, publicUrl: null, message, outputTail: [] };
}

export async function publishFutureWorkoutAsPublicNextRun(pacerWorkoutId: string, deploy = deployRunSite) {
  const published = getStoredFutureWorkoutPublication(pacerWorkoutId);
  if (published?.ok) return { operation: 'unchanged' as const, nextRun: null, publishStatus: previouslyPublishedStatus(published.message) };
  const nextRun = refreshPublicNextRunSnapshot(pacerWorkoutId);
  const publishStatus = await deploy();
  recordStoredFutureWorkoutPublication(pacerWorkoutId, publishStatus.ok, publishStatus.message);
  return { operation: 'created' as const, nextRun, publishStatus };
}

export interface CompleteSkippedWorkoutInput {
  explanation?: unknown;
  futureWorkout?: unknown;
  /** Explicitly opt into public-site deployment; Intervals sync and public publishing are separate operations. */
  publishNextRun?: unknown;
}

export interface SkipCompletionDependencies {
  skip: typeof markFutureWorkoutSkipped;
  cancelRemote: typeof cancelSkippedWorkoutRemotely;
  importWorkout: typeof importFutureWorkout;
  approve: typeof approveFutureWorkout;
  synchronize: typeof synchronizeFutureWorkout;
  publishNextRun: typeof publishFutureWorkoutAsPublicNextRun;
}

export interface SkipCompletionRemoteCancellation {
  operation: 'deleted' | 'already_absent' | 'unchanged' | 'failed';
  cancellation: StoredFutureWorkoutRemoteCancellation | null;
  garmin: { status: 'not_attempted_unverified' };
  error: string | null;
}

export interface SkipCompletionResult {
  complete: boolean;
  stage: 'sync' | 'publish' | 'complete';
  skip: Awaited<ReturnType<typeof markFutureWorkoutSkipped>>;
  remoteCancellation: SkipCompletionRemoteCancellation;
  imported: ReturnType<typeof importFutureWorkout>;
  approved: FutureWorkoutApiRecord;
  synchronized: FutureWorkoutApiRecord;
  publicNextRun: Awaited<ReturnType<typeof publishFutureWorkoutAsPublicNextRun>> | null;
}

const defaultSkipCompletionDependencies: SkipCompletionDependencies = {
  skip: markFutureWorkoutSkipped,
  cancelRemote: cancelSkippedWorkoutRemotely,
  importWorkout: importFutureWorkout,
  approve: approveFutureWorkout,
  synchronize: synchronizeFutureWorkout,
  publishNextRun: publishFutureWorkoutAsPublicNextRun,
};
const skipCompletionInFlight = new Map<string, Promise<SkipCompletionResult>>();

/** Cancellation failure is deliberately non-fatal: its persisted failure state is retryable. */
async function cancelRemoteForCompletion(
  pacerWorkoutId: string,
  cancelRemote: SkipCompletionDependencies['cancelRemote'],
): Promise<SkipCompletionRemoteCancellation> {
  try {
    const result = await cancelRemote(pacerWorkoutId);
    return { ...result, error: null };
  } catch (error) {
    return {
      operation: 'failed',
      cancellation: getStoredFutureWorkoutRemoteCancellation(pacerWorkoutId),
      garmin: { status: 'not_attempted_unverified' },
      error: (error as Error).message,
    };
  }
}

/**
 * Resumable orchestration for the explicit Skip Workout completion action.
 * Every step delegates to the existing idempotent storage/sync operation. A
 * completed skip is never rolled back if a later remote operation fails.
 */
export async function completeSkippedWorkout(
  skippedWorkoutId: string,
  input: CompleteSkippedWorkoutInput,
  dependencies: SkipCompletionDependencies = defaultSkipCompletionDependencies,
): Promise<SkipCompletionResult> {
  const existing = skipCompletionInFlight.get(skippedWorkoutId);
  if (existing) return existing;
  const operation = (async (): Promise<SkipCompletionResult> => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('A completion request body is required.');
    if (!Object.prototype.hasOwnProperty.call(input, 'futureWorkout')) throw new Error('futureWorkout is required.');
    if (input.publishNextRun !== undefined && typeof input.publishNextRun !== 'boolean') throw new Error('publishNextRun must be a boolean when provided.');
    const skip = await dependencies.skip(skippedWorkoutId, { explanation: skipExplanation(input) });
    const remoteCancellation = await cancelRemoteForCompletion(skippedWorkoutId, dependencies.cancelRemote);
    const imported = dependencies.importWorkout === importFutureWorkout
      ? importFutureWorkoutForCompletion(input.futureWorkout)
      : dependencies.importWorkout(input.futureWorkout);
    const replacementId = imported.proposal.workout.pacerWorkoutId;
    if (replacementId === skippedWorkoutId) throw new Error('The replacement workout must be different from the skipped workout.');
    const approved = imported.proposal.workout.lifecycle.approvalStatus === 'approved'
      ? imported.proposal
      : dependencies.approve(replacementId, {});
    const synchronized = approved.workout.lifecycle.syncStatus === 'synced'
      ? approved
      : await dependencies.synchronize(replacementId);
    if (synchronized.workout.lifecycle.syncStatus !== 'synced') {
      return { complete: false, stage: 'sync' as const, skip, remoteCancellation, imported, approved, synchronized, publicNextRun: null };
    }
    const publicNextRun = input.publishNextRun === true
      ? await dependencies.publishNextRun(replacementId)
      : null;
    if (publicNextRun && !publicNextRun.publishStatus.ok) {
      return { complete: false, stage: 'publish' as const, skip, remoteCancellation, imported, approved, synchronized, publicNextRun };
    }
    return { complete: true, stage: 'complete' as const, skip, remoteCancellation, imported, approved, synchronized, publicNextRun };
  })();
  skipCompletionInFlight.set(skippedWorkoutId, operation);
  try { return await operation; } finally { skipCompletionInFlight.delete(skippedWorkoutId); }
}
