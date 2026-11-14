import { config } from '../config';
import type { FutureWorkoutBlock, FutureWorkoutProposal, FutureWorkoutStep } from './types';

export interface IntervalsCalendarEvent {
  category: 'WORKOUT'; type: 'Run'; name: string; description: string;
  start_date_local: string; external_id: string;
}

export interface IntervalsCalendarResponse extends IntervalsCalendarEvent {
  id: number; workout_doc?: { steps?: unknown[] };
}

export interface IntervalsCalendarClient {
  upsert(event: IntervalsCalendarEvent): Promise<IntervalsCalendarResponse>;
  findByExternalId(externalId: string, localDate: string): Promise<IntervalsCalendarResponse | null>;
  /** Deletes one known calendar event. Callers must establish ownership before using it. */
  deleteById?(eventId: string): Promise<void>;
}

function pace(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;
}

function duration(step: FutureWorkoutStep): string {
  return step.duration.unit === 'time'
    ? `${Math.floor(step.duration.seconds / 60)}m${step.duration.seconds % 60 ? `${step.duration.seconds % 60}s` : ''}`
    : `${step.duration.meters / 1000}km`;
}

function intensity(step: FutureWorkoutStep): string {
  return step.kind === 'work' ? 'active' : step.kind;
}

function athleteFacingText(step: FutureWorkoutStep): string {
  if (!step.cue) return step.label ?? '';
  return step.label ? `${step.label}: ${step.cue}` : step.cue;
}

function stepText(step: FutureWorkoutStep): string {
  const target = step.target.kind === 'pace'
    ? ` ${pace(step.target.minSecPerKm)}${step.target.minSecPerKm === step.target.maxSecPerKm ? '' : `-${pace(step.target.maxSecPerKm)}`}/km Pace`
    : '';
  // Intervals parses free text before the duration as the device cue/label.
  // Its explicit intensity flag is preserved in FIT exports (and avoids target-based guessing).
  const text = athleteFacingText(step);
  return `- ${text ? `${text} ` : ''}${duration(step)}${target} intensity=${intensity(step)}`;
}

function blockText(block: FutureWorkoutBlock): string[] {
  if (block.kind !== 'repeat') return [stepText(block)];
  return [`${block.label ? `${block.label} ` : ''}${block.repetitions}x`, ...block.steps.map(stepText)];
}

/** Native Intervals workout-description syntax. Pace is seconds/km in Pacer and min/max is fastest-to-slowest. */
export function intervalsWorkoutDescription(workout: FutureWorkoutProposal): string {
  return workout.blocks.map((block) => blockText(block).join('\n')).join('\n\n');
}

/** Intervals treats midnight local as a date-only planned calendar workout. */
export function toIntervalsCalendarEvent(workout: FutureWorkoutProposal): IntervalsCalendarEvent {
  return {
    category: 'WORKOUT', type: 'Run', name: workout.title,
    description: intervalsWorkoutDescription(workout),
    start_date_local: `${workout.schedule.localDate}T00:00:00`,
    external_id: workout.intervalsEventKey,
  };
}

export function validateIntervalsCalendarIdentity(event: IntervalsCalendarResponse, expected: IntervalsCalendarEvent): void {
  if (!Number.isInteger(event.id) || event.id <= 0) throw new Error('Intervals response did not include a valid event ID.');
  if (event.external_id !== expected.external_id || event.category !== 'WORKOUT' || event.type !== 'Run') {
    throw new Error('Intervals response does not match the Pacer workout identity.');
  }
  if (event.start_date_local.slice(0, 10) !== expected.start_date_local.slice(0, 10)) throw new Error('Intervals response changed the scheduled date.');
}

export function validateIntervalsCalendarResponse(event: IntervalsCalendarResponse, expected: IntervalsCalendarEvent): void {
  validateIntervalsCalendarIdentity(event, expected);
  if (!Array.isArray(event.workout_doc?.steps) || event.workout_doc.steps.length === 0) throw new Error('Intervals did not return a parsed workout structure.');
}

function authHeader(): string {
  if (!config.intervalsApiKey) throw new Error('INTERVALS_API_KEY is required for calendar synchronization.');
  return `Basic ${Buffer.from(`API_KEY:${config.intervalsApiKey}`).toString('base64')}`;
}

export function createIntervalsCalendarClient(fetchImpl: typeof fetch = fetch): IntervalsCalendarClient {
  return {
    async upsert(event) {
      const url = `${config.intervalsApiBaseUrl.replace(/\/$/, '')}/athlete/${encodeURIComponent(config.intervalsAthleteId)}/events/bulk?upsert=true`;
      const response = await fetchImpl(url, { method: 'POST', headers: { Authorization: authHeader(), 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify([event]) });
      if (!response.ok) throw new Error(`Intervals calendar upsert failed (${response.status}).`);
      const body = await response.json() as unknown;
      if (!Array.isArray(body) || body.length !== 1 || !body[0] || typeof body[0] !== 'object') throw new Error('Intervals calendar upsert returned an invalid response.');
      return body[0] as IntervalsCalendarResponse;
    },
    async findByExternalId(externalId, localDate) {
      const url = new URL(`${config.intervalsApiBaseUrl.replace(/\/$/, '')}/athlete/${encodeURIComponent(config.intervalsAthleteId)}/events`);
      url.searchParams.set('oldest', localDate); url.searchParams.set('newest', localDate);
      const response = await fetchImpl(url, { headers: { Authorization: authHeader(), Accept: 'application/json' } });
      if (!response.ok) throw new Error(`Intervals calendar reconciliation failed (${response.status}).`);
      const events = await response.json() as unknown;
      if (!Array.isArray(events)) throw new Error('Intervals calendar reconciliation returned an invalid response.');
      return (events.find((entry) => entry && typeof entry === 'object' && (entry as { external_id?: unknown }).external_id === externalId) ?? null) as IntervalsCalendarResponse | null;
    },
    async deleteById(eventId) {
      if (!/^\d+$/.test(eventId)) throw new Error('Intervals event ID is invalid.');
      const url = `${config.intervalsApiBaseUrl.replace(/\/$/, '')}/athlete/${encodeURIComponent(config.intervalsAthleteId)}/events/${encodeURIComponent(eventId)}`;
      const response = await fetchImpl(url, { method: 'DELETE', headers: { Authorization: authHeader(), Accept: 'application/json' } });
      if (!response.ok && response.status !== 404) throw new Error(`Intervals calendar deletion failed (${response.status}).`);
    },
  };
}

export async function upsertIntervalsWorkout(workout: FutureWorkoutProposal, client = createIntervalsCalendarClient()): Promise<IntervalsCalendarResponse> {
  if (workout.lifecycle.approvalStatus !== 'approved') throw new Error('Only approved future workouts can synchronize.');
  const event = toIntervalsCalendarEvent(workout);
  const response = await client.upsert(event);
  validateIntervalsCalendarResponse(response, event);
  return response;
}
