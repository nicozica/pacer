import type { CANONICAL_SESSION_TYPES } from '../training/activity-names';

export const FUTURE_WORKOUT_CONTRACT_VERSION = 'future-workout-v1' as const;

export type PacerWorkoutType = typeof CANONICAL_SESSION_TYPES[number];
export type WorkoutStepKind = 'warmup' | 'work' | 'recovery' | 'cooldown';
export type WorkoutApprovalStatus = 'proposed' | 'approved' | 'rejected' | 'superseded';
export type WorkoutSyncStatus = 'not_requested' | 'syncing' | 'synced' | 'failed';

export interface FutureWorkoutSourceSession {
  sourceActivityId: number;
  sessionDate: string;
}

export interface FutureWorkoutSchedule {
  localDate: string;
  timezone: string;
}

export interface TimeStepDuration {
  unit: 'time';
  seconds: number;
}

export interface DistanceStepDuration {
  unit: 'distance';
  meters: number;
}

export type FutureWorkoutStepDuration = TimeStepDuration | DistanceStepDuration;

export interface UnrestrictedEffort {
  kind: 'unrestricted';
}

/** Pace is seconds per kilometre. Equal bounds represent an exact target. */
export interface PaceEffort {
  kind: 'pace';
  minSecPerKm: number;
  maxSecPerKm: number;
}

export type FutureWorkoutEffort = UnrestrictedEffort | PaceEffort;

export interface FutureWorkoutStep {
  kind: WorkoutStepKind;
  label?: string;
  duration: FutureWorkoutStepDuration;
  target: FutureWorkoutEffort;
}

export interface FutureWorkoutRepeatGroup {
  kind: 'repeat';
  repetitions: number;
  label?: string;
  steps: FutureWorkoutStep[];
}

export type FutureWorkoutBlock = FutureWorkoutStep | FutureWorkoutRepeatGroup;

export interface FutureWorkoutLifecycle {
  approvalStatus: WorkoutApprovalStatus;
  approvedAt: string | null;
  approvalNote: string | null;
  syncStatus: WorkoutSyncStatus;
  syncedAt: string | null;
  intervalsEventId: string | null;
  lastSyncError: string | null;
}

/**
 * Validated, Pacer-owned representation. `pacerWorkoutId` and
 * `intervalsEventKey` are derived deterministically and must never be supplied
 * as trusted identifiers by Coachat.
 */
export interface FutureWorkoutProposal {
  contractVersion: typeof FUTURE_WORKOUT_CONTRACT_VERSION;
  pacerWorkoutId: string;
  proposalKey: string;
  proposalRevision: number;
  proposedAt: string;
  updatedAt: string;
  sourceSession: FutureWorkoutSourceSession;
  schedule: FutureWorkoutSchedule;
  workoutType: PacerWorkoutType;
  title: string;
  coachingNotes: string;
  blocks: FutureWorkoutBlock[];
  lifecycle: FutureWorkoutLifecycle;
  intervalsEventKey: string;
}
