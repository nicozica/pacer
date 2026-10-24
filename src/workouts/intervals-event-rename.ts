import { config } from '../config';

export interface IntervalsEventRenameSnapshot {
  id: number;
  external_id: string;
  start_date_local: string;
  category: string;
  type: string;
  name: string;
  description: string;
  workout_doc?: unknown;
  [key: string]: unknown;
}

export interface IntervalsEventRenameClient {
  get(eventId: number): Promise<IntervalsEventRenameSnapshot>;
  put(eventId: number, body: Record<string, unknown>): Promise<IntervalsEventRenameSnapshot>;
}

function steps(snapshot: IntervalsEventRenameSnapshot): unknown {
  const doc = snapshot.workout_doc;
  return doc && typeof doc === 'object' ? (doc as { steps?: unknown }).steps : undefined;
}

export interface IntervalsEventRenameInput {
  eventId: number;
  externalId: string;
  localDate: string;
  expectedTitle: string;
  nextTitle: string;
  dryRun?: boolean;
}

function authHeader(): string {
  if (!config.intervalsApiKey) throw new Error('INTERVALS_API_KEY is required for Intervals event maintenance.');
  return `Basic ${Buffer.from(`API_KEY:${config.intervalsApiKey}`).toString('base64')}`;
}

/** HTTP adapter intentionally has no retry behavior; callers must explicitly authorize each rename. */
export function createIntervalsEventRenameClient(fetchImpl: typeof fetch = fetch): IntervalsEventRenameClient {
  const eventUrl = (eventId: number) => `${config.intervalsApiBaseUrl.replace(/\/$/, '')}/athlete/${encodeURIComponent(config.intervalsAthleteId)}/events/${eventId}`;
  const parse = async (response: Response, action: string): Promise<IntervalsEventRenameSnapshot> => {
    if (!response.ok) throw new Error(`Intervals event ${action} failed (${response.status}).`);
    const body = await response.json() as unknown;
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(`Intervals event ${action} returned an invalid response.`);
    return body as IntervalsEventRenameSnapshot;
  };
  return {
    get: async (eventId) => parse(await fetchImpl(eventUrl(eventId), { headers: { Authorization: authHeader(), Accept: 'application/json' } }), 'GET'),
    put: async (eventId, body) => parse(await fetchImpl(eventUrl(eventId), { method: 'PUT', headers: { Authorization: authHeader(), Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), 'PUT'),
  };
}

const WRITABLE_FIELDS = [
  'calendar_id', 'start_date_local', 'end_date_local', 'category', 'type', 'name', 'description', 'indoor', 'color',
  'not_on_fitness_chart', 'show_as_note', 'show_on_ctl_line', 'for_week', 'target', 'carbs_used', 'carbs_per_hour',
  'external_id', 'load_target', 'time_target', 'distance_target', 'training_availability', 'max_training_time',
  'can_train_sports', 'hide_from_athlete', 'tags', 'sub_type', 'attachments',
] as const;

function same(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }

function validateSnapshot(snapshot: IntervalsEventRenameSnapshot, input: IntervalsEventRenameInput): void {
  if (snapshot.id !== input.eventId || snapshot.external_id !== input.externalId || snapshot.start_date_local.slice(0, 10) !== input.localDate
    || snapshot.category !== 'WORKOUT' || snapshot.type !== 'Run' || snapshot.name !== input.expectedTitle) {
    throw new Error('Intervals event no longer matches the expected workout identity and title.');
  }
}

/** Produces an in-place EventEx body from a fresh GET response; never sends workout_doc. */
export function buildIntervalsEventRenamePayload(snapshot: IntervalsEventRenameSnapshot, nextTitle: string): Record<string, unknown> {
  if (!nextTitle.trim()) throw new Error('Intervals event title is required.');
  return Object.fromEntries(WRITABLE_FIELDS.map((field) => [field, field === 'name' ? nextTitle.trim() : snapshot[field]]));
}

export async function renameIntervalsEvent(input: IntervalsEventRenameInput, client: IntervalsEventRenameClient): Promise<{ applied: boolean; before: IntervalsEventRenameSnapshot; after: IntervalsEventRenameSnapshot | null; body: Record<string, unknown> }> {
  const before = await client.get(input.eventId);
  validateSnapshot(before, input);
  const body = buildIntervalsEventRenamePayload(before, input.nextTitle);
  for (const [field, value] of Object.entries(body)) {
    if (field !== 'name' && !same(value, before[field])) throw new Error(`Intervals rename would alter unrelated field ${field}.`);
  }
  if ('workout_doc' in body || !same(body.description, before.description)) throw new Error('Intervals rename must preserve description and omit workout_doc.');
  if (input.dryRun) return { applied: false, before, after: null, body };
  const putResponse = await client.put(input.eventId, body);
  const after = await client.get(input.eventId);
  if (putResponse.id !== before.id || putResponse.external_id !== before.external_id) {
    throw new Error('Intervals rename PUT returned the wrong event identity.');
  }
  if (after.id !== before.id || after.external_id !== before.external_id || after.start_date_local !== before.start_date_local
    || after.category !== before.category || after.type !== before.type || after.name !== input.nextTitle.trim()
    || !same(after.description, before.description) || !same(steps(after), steps(before))) {
    throw new Error('Intervals rename verification failed after the single PUT.');
  }
  return { applied: true, before, after, body };
}

