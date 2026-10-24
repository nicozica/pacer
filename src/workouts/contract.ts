import { createHash } from 'node:crypto';
import { CANONICAL_SESSION_TYPES } from '../training/activity-names';
import {
  FUTURE_WORKOUT_CONTRACT_VERSION,
  FutureWorkoutBlock,
  FutureWorkoutLifecycle,
  FutureWorkoutProposal,
  FutureWorkoutRepeatGroup,
  FutureWorkoutStep,
  PacerWorkoutType,
} from './types';

const WORKOUT_TYPES = new Set<string>(CANONICAL_SESSION_TYPES);
const STEP_KINDS = new Set(['warmup', 'work', 'recovery', 'cooldown']);
const APPROVAL_STATUSES = new Set(['proposed', 'approved', 'rejected', 'superseded']);
const SYNC_STATUSES = new Set(['not_requested', 'pending', 'synced', 'failed']);

export class FutureWorkoutValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FutureWorkoutValidationError';
  }
}

function fail(message: string): never {
  throw new FutureWorkoutValidationError(message);
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${path} must be an object.`);
  return value as Record<string, unknown>;
}

function text(value: unknown, path: string, required = true): string {
  if (value === undefined || value === null) {
    if (required) fail(`${path} is required.`);
    return '';
  }
  if (typeof value !== 'string') fail(`${path} must be a string.`);
  const normalized = value.trim();
  if (required && !normalized) fail(`${path} is required.`);
  return normalized;
}

function positiveInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    fail(`${path} must be a positive integer.`);
  }
  return value;
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${path} must be a finite number.`);
  return value;
}

function date(value: unknown, path: string): string {
  const parsed = text(value, path);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed)) fail(`${path} must use YYYY-MM-DD.`);
  const timestamp = Date.parse(`${parsed}T12:00:00Z`);
  if (Number.isNaN(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== parsed) {
    fail(`${path} must be a real calendar date.`);
  }
  return parsed;
}

function timestamp(value: unknown, path: string): string {
  const parsed = text(value, path);
  if (Number.isNaN(Date.parse(parsed))) fail(`${path} must be an ISO timestamp.`);
  return parsed;
}

function optionalTimestamp(value: unknown, path: string): string | null {
  if (value === undefined || value === null) return null;
  return timestamp(value, path);
}

function optionalText(value: unknown, path: string): string | null {
  if (value === undefined || value === null) return null;
  return text(value, path, false) || null;
}

/** Keep cue text safely inside the Intervals structured-text prefix. */
function optionalStepCue(value: unknown, path: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  const cue = text(value, path, false);
  if (!cue) return undefined;
  if (cue.length > 120) fail(`${path} must be at most 120 characters.`);
  if (!/^[A-Za-z0-9][A-Za-z0-9 ,.?'!\-]*$/.test(cue)) {
    fail(`${path} must be a concise single-line English coaching cue using letters, numbers, spaces, and basic punctuation.`);
  }
  return cue;
}

function timezone(value: unknown): string {
  const zone = text(value, 'schedule.timezone');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
  } catch {
    fail('schedule.timezone must be an IANA timezone.');
  }
  return zone;
}

function parseStep(value: unknown, path: string): FutureWorkoutStep {
  const raw = object(value, path);
  const kind = text(raw.kind, `${path}.kind`);
  if (!STEP_KINDS.has(kind)) fail(`${path}.kind must be warmup, work, recovery, or cooldown.`);
  const duration = object(raw.duration, `${path}.duration`);
  const unit = text(duration.unit, `${path}.duration.unit`);
  let parsedDuration: FutureWorkoutStep['duration'];
  if (unit === 'time') {
    const seconds = positiveInteger(duration.seconds, `${path}.duration.seconds`);
    if (seconds > 12 * 60 * 60) fail(`${path}.duration.seconds is implausibly long.`);
    parsedDuration = { unit, seconds };
  } else if (unit === 'distance') {
    const meters = finiteNumber(duration.meters, `${path}.duration.meters`);
    if (meters <= 0 || meters > 100_000) fail(`${path}.duration.meters must be between 1 and 100000.`);
    parsedDuration = { unit, meters };
  } else {
    fail(`${path}.duration.unit must be time or distance.`);
  }

  const target = object(raw.target, `${path}.target`);
  const targetKind = text(target.kind, `${path}.target.kind`);
  let parsedTarget: FutureWorkoutStep['target'];
  if (targetKind === 'unrestricted') {
    if (target.minSecPerKm !== undefined || target.maxSecPerKm !== undefined) {
      fail(`${path}.target unrestricted effort cannot include pace bounds.`);
    }
    parsedTarget = { kind: 'unrestricted' };
  } else if (targetKind === 'pace') {
    const minSecPerKm = finiteNumber(target.minSecPerKm, `${path}.target.minSecPerKm`);
    const maxSecPerKm = finiteNumber(target.maxSecPerKm, `${path}.target.maxSecPerKm`);
    if (minSecPerKm <= 0 || maxSecPerKm <= 0 || minSecPerKm > maxSecPerKm) {
      fail(`${path}.target pace bounds must be positive and ordered fastest-to-slowest.`);
    }
    parsedTarget = { kind: 'pace', minSecPerKm, maxSecPerKm };
  } else {
    fail(`${path}.target.kind must be unrestricted or pace.`);
  }

  const label = raw.label === undefined ? undefined : text(raw.label, `${path}.label`, false);
  const cue = optionalStepCue(raw.cue, `${path}.cue`);
  return {
    kind: kind as FutureWorkoutStep['kind'],
    ...(label ? { label } : {}),
    ...(cue ? { cue } : {}),
    duration: parsedDuration,
    target: parsedTarget,
  };
}

function parseBlock(value: unknown, path: string): FutureWorkoutBlock {
  const raw = object(value, path);
  if (raw.kind !== 'repeat') return parseStep(raw, path);
  const repetitions = positiveInteger(raw.repetitions, `${path}.repetitions`);
  if (repetitions < 2 || repetitions > 100) fail(`${path}.repetitions must be between 2 and 100.`);
  if (!Array.isArray(raw.steps) || raw.steps.length === 0) fail(`${path}.steps must be a non-empty array.`);
  const steps = raw.steps.map((step, index) => {
    const child = object(step, `${path}.steps[${index}]`);
    if (child.kind === 'repeat') fail(`${path}.steps[${index}] cannot nest repeat groups.`);
    return parseStep(child, `${path}.steps[${index}]`);
  });
  if (!steps.some((step) => step.kind === 'work')) fail(`${path} must contain at least one work step.`);
  const label = raw.label === undefined ? undefined : text(raw.label, `${path}.label`, false);
  return { kind: 'repeat', repetitions, ...(label ? { label } : {}), steps } as FutureWorkoutRepeatGroup;
}

function parseLifecycle(value: unknown): FutureWorkoutLifecycle {
  const raw = object(value, 'lifecycle');
  const approvalStatus = text(raw.approvalStatus, 'lifecycle.approvalStatus');
  const syncStatus = text(raw.syncStatus, 'lifecycle.syncStatus');
  if (!APPROVAL_STATUSES.has(approvalStatus)) fail('lifecycle.approvalStatus is invalid.');
  if (!SYNC_STATUSES.has(syncStatus)) fail('lifecycle.syncStatus is invalid.');
  return {
    approvalStatus: approvalStatus as FutureWorkoutLifecycle['approvalStatus'],
    approvedAt: optionalTimestamp(raw.approvedAt, 'lifecycle.approvedAt'),
    approvalNote: optionalText(raw.approvalNote, 'lifecycle.approvalNote'),
    syncStatus: syncStatus as FutureWorkoutLifecycle['syncStatus'],
    syncedAt: optionalTimestamp(raw.syncedAt, 'lifecycle.syncedAt'),
    intervalsEventId: optionalText(raw.intervalsEventId, 'lifecycle.intervalsEventId'),
    lastSyncError: optionalText(raw.lastSyncError, 'lifecycle.lastSyncError'),
  };
}

export function futureWorkoutIdentityKey(input: Pick<FutureWorkoutProposal, 'proposalKey' | 'sourceSession' | 'schedule'>): string {
  return [input.sourceSession.sourceActivityId, input.sourceSession.sessionDate, input.schedule.localDate, input.schedule.timezone, input.proposalKey].join('|');
}

export function derivePacerWorkoutId(input: Pick<FutureWorkoutProposal, 'proposalKey' | 'sourceSession' | 'schedule'>): string {
  const digest = createHash('sha256').update(futureWorkoutIdentityKey(input)).digest('hex').slice(0, 20);
  return `pacer-fw1-${digest}`;
}

export function deriveIntervalsEventKey(input: Pick<FutureWorkoutProposal, 'proposalKey' | 'sourceSession' | 'schedule'>): string {
  return `pacer:${derivePacerWorkoutId(input)}`;
}

/** Parses a Coachat proposal. Imported proposals are intentionally inert. */
export function importFutureWorkoutProposal(value: unknown): FutureWorkoutProposal {
  const raw = object(value, 'future workout proposal');
  if (raw.contractVersion !== FUTURE_WORKOUT_CONTRACT_VERSION) {
    fail(`contractVersion must be ${FUTURE_WORKOUT_CONTRACT_VERSION}.`);
  }
  if (raw.pacerWorkoutId !== undefined || raw.intervalsEventKey !== undefined) {
    fail('pacerWorkoutId and intervalsEventKey are Pacer-owned and must not be imported.');
  }

  const proposalKey = text(raw.proposalKey, 'proposalKey').toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$/.test(proposalKey)) {
    fail('proposalKey must be a stable lowercase slug between 3 and 80 characters.');
  }
  const source = object(raw.sourceSession, 'sourceSession');
  const sourceSession = {
    sourceActivityId: positiveInteger(source.sourceActivityId, 'sourceSession.sourceActivityId'),
    sessionDate: date(source.sessionDate, 'sourceSession.sessionDate'),
  };
  const scheduleRaw = object(raw.schedule, 'schedule');
  const schedule = { localDate: date(scheduleRaw.localDate, 'schedule.localDate'), timezone: timezone(scheduleRaw.timezone) };
  const workoutType = text(raw.workoutType, 'workoutType');
  if (!WORKOUT_TYPES.has(workoutType)) fail('workoutType must be a canonical Pacer workout type.');
  if (!Array.isArray(raw.blocks) || raw.blocks.length === 0) fail('blocks must be a non-empty array.');
  const blocks = raw.blocks.map((block, index) => parseBlock(block, `blocks[${index}]`));
  if (!blocks.some((block) => block.kind === 'work' || (block.kind === 'repeat' && block.steps.some((step) => step.kind === 'work')))) {
    fail('blocks must include at least one work step or repeat group containing work.');
  }
  const lifecycle = parseLifecycle(raw.lifecycle);
  if (lifecycle.approvalStatus !== 'proposed' || lifecycle.syncStatus !== 'not_requested'
    || lifecycle.approvedAt !== null || lifecycle.syncedAt !== null || lifecycle.intervalsEventId !== null) {
    fail('Imported proposals must be unapproved and not synchronized.');
  }
  const identity = { proposalKey, sourceSession, schedule };
  return {
    contractVersion: FUTURE_WORKOUT_CONTRACT_VERSION,
    pacerWorkoutId: derivePacerWorkoutId(identity),
    intervalsEventKey: deriveIntervalsEventKey(identity),
    proposalKey,
    proposalRevision: positiveInteger(raw.proposalRevision, 'proposalRevision'),
    proposedAt: timestamp(raw.proposedAt, 'proposedAt'),
    updatedAt: timestamp(raw.updatedAt, 'updatedAt'),
    sourceSession,
    schedule,
    workoutType: workoutType as PacerWorkoutType,
    title: text(raw.title, 'title'),
    coachingNotes: text(raw.coachingNotes, 'coachingNotes', false),
    blocks,
    lifecycle,
  };
}

/** Phase 2B uses this to reject accidental overwrites during persistence. */
export function canReplaceFutureWorkout(existing: FutureWorkoutProposal, incoming: FutureWorkoutProposal): boolean {
  return existing.pacerWorkoutId === incoming.pacerWorkoutId
    && existing.lifecycle.approvalStatus === 'proposed'
    && incoming.lifecycle.approvalStatus === 'proposed'
    && incoming.proposalRevision > existing.proposalRevision;
}
