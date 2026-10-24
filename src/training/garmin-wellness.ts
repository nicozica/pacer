import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { config } from '../config';

export type GarminAvailability = 'fresh' | 'stale' | 'unavailable';
export type GarminFailureReason = 'authentication_failed' | 'rate_limited' | 'timed_out' | 'malformed_response' | 'service_unavailable' | 'key_expired' | null;
export type GarminKeyExpiryStatus = 'ok' | 'expires_within_30_days' | 'expires_within_7_days' | 'expired' | 'unknown';

export interface GarminBodyBatterySample { timestamp: string; value: number; }
export interface GarminWellnessDay {
  source: 'garmin_personal_api';
  date: string;
  dataTimestamp: string | null;
  sleepDurationS: number | null;
  sleepScore: number | null;
  deepSleepS: number | null;
  lightSleepS: number | null;
  remSleepS: number | null;
  awakeSleepS: number | null;
  sleepStart: string | null;
  sleepEnd: string | null;
  sleepStartLocal: string | null;
  sleepEndLocal: string | null;
  sleepStress: number | null;
  restingHeartRate: number | null;
  heartRateMin: number | null;
  heartRateMax: number | null;
  hrv: number | null;
  stressLevel: number | null;
  stressRestS: number | null;
  stressLowS: number | null;
  stressMediumS: number | null;
  stressHighS: number | null;
  bodyBatteryLatest: number | null;
  bodyBatteryMin: number | null;
  bodyBatteryMax: number | null;
  bodyBatteryMorning: number | null;
  bodyBatteryCharged: number | null;
  bodyBatteryDrained: number | null;
  bodyBatterySamples: GarminBodyBatterySample[];
  weightKg: number | null;
  weightMeasuredAt: string | null;
}

export interface GarminWellnessContext {
  source: 'garmin_personal_api';
  provenance: 'garmin_personal_api_wellness';
  availability: GarminAvailability;
  sessionDate: string;
  timeZone: string;
  fetchedAt: string | null;
  lastSuccessfulFetch: string | null;
  failureReason: GarminFailureReason;
  keyExpiryStatus: GarminKeyExpiryStatus;
  days: GarminWellnessDay[];
  sessionDay: GarminWellnessDay | null;
}

type JsonRecord = Record<string, unknown>;
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
interface BearerToken { accessToken: string; expiresAt: number; fingerprint: string; }
export interface GarminWellnessOptions {
  sessionDate: string;
  storageDir: string;
  enabled?: boolean;
  keyFile?: string;
  tokenCacheFile?: string;
  baseUrl?: string;
  timeoutMs?: number;
  totalTimeoutMs?: number;
  timeZone?: string;
  keyExpiresOn?: string;
  fetchImpl?: FetchLike;
  now?: () => Date;
}

const TOKEN_PATH = '/personalapitoken-service/personal-api/personal-api-key/token';
const REFRESH_WINDOW_MS = 60 * 60 * 1000;
const CACHE_REFRESH_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

class GarminHttpError extends Error {
  constructor(readonly status: number, readonly kind: 'http' | 'timeout' | 'malformed') { super(kind); }
}

function record(value: unknown): JsonRecord { return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}; }
function numberOrNull(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
function isoDate(value: unknown): string | null { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null; }
function isoFromEpoch(value: unknown): string | null {
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return value;
  const numeric = numberOrNull(value);
  if (numeric === null) return null;
  const millis = numeric > 10_000_000_000 ? numeric : numeric * 1000;
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
function localDateTime(iso: string | null, timeZone: string): string | null {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
  } catch { return null; }
}
function shiftDate(date: string, days: number): string {
  const value = Date.parse(`${date}T12:00:00Z`);
  return Number.isNaN(value) ? date : new Date(value + days * DAY_MS).toISOString().slice(0, 10);
}
function cacheFile(storageDir: string, sessionDate: string): string { return path.join(storageDir, 'json', 'garmin-wellness', `${sessionDate}.json`); }
function keyExpiryStatus(expiresOn: string, now: Date): GarminKeyExpiryStatus {
  const expiry = Date.parse(`${expiresOn}T23:59:59Z`);
  if (Number.isNaN(expiry)) return 'unknown';
  const days = Math.ceil((expiry - now.getTime()) / DAY_MS);
  if (days < 0) return 'expired';
  if (days <= 7) return 'expires_within_7_days';
  if (days <= 30) return 'expires_within_30_days';
  return 'ok';
}
function unavailable(sessionDate: string, timeZone: string, keyStatus: GarminKeyExpiryStatus, failureReason: GarminFailureReason = null): GarminWellnessContext {
  return { source: 'garmin_personal_api', provenance: 'garmin_personal_api_wellness', availability: 'unavailable', sessionDate, timeZone, fetchedAt: null, lastSuccessfulFetch: null, failureReason, keyExpiryStatus: keyStatus, days: [], sessionDay: null };
}
function validContext(value: unknown): GarminWellnessContext | null {
  const context = record(value);
  if (context.provenance !== 'garmin_personal_api_wellness' || typeof context.sessionDate !== 'string' || !Array.isArray(context.days)) return null;
  return context as unknown as GarminWellnessContext;
}
function readCached(storageDir: string, sessionDate: string): GarminWellnessContext | null {
  try { return validContext(JSON.parse(fs.readFileSync(cacheFile(storageDir, sessionDate), 'utf8'))); } catch { return null; }
}
function writeCached(storageDir: string, context: GarminWellnessContext): void {
  const target = cacheFile(storageDir, context.sessionDate);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(target), 0o700);
  fs.writeFileSync(target, JSON.stringify(context, null, 2), { mode: 0o600 });
}
function fresh(context: GarminWellnessContext, now: Date): boolean {
  if (!context.fetchedAt) return false;
  const fetched = Date.parse(context.fetchedAt);
  const session = Date.parse(`${context.sessionDate}T12:00:00Z`);
  if (Number.isNaN(fetched) || Number.isNaN(session)) return false;
  // Historical records are immutable enough to avoid needless Personal API calls.
  if (now.getTime() - session > 7 * DAY_MS) return true;
  return now.getTime() - fetched < CACHE_REFRESH_MS;
}
function fingerprint(key: string, baseUrl: string): string { return crypto.createHash('sha256').update(`${baseUrl}\0${key}`).digest('hex'); }
function tokenExpiry(token: string): number | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as JsonRecord;
    const exp = numberOrNull(payload.exp);
    return exp === null ? null : exp * 1000;
  } catch { return null; }
}
function loadToken(cache: string, expectedFingerprint: string, now: Date): BearerToken | null {
  try {
    const value = record(JSON.parse(fs.readFileSync(cache, 'utf8')));
    const accessToken = typeof value.access_token === 'string' ? value.access_token : '';
    const expiresAt = numberOrNull(value.expires_at);
    if (!accessToken || expiresAt === null || value.fingerprint !== expectedFingerprint || expiresAt - now.getTime() <= REFRESH_WINDOW_MS) return null;
    return { accessToken, expiresAt, fingerprint: expectedFingerprint };
  } catch { return null; }
}
function saveToken(cache: string, token: BearerToken): void {
  fs.mkdirSync(path.dirname(cache), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(cache), 0o700);
  const temporary = `${cache}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ fingerprint: token.fingerprint, access_token: token.accessToken, expires_at: token.expiresAt }), { mode: 0o600 });
  fs.renameSync(temporary, cache);
  fs.chmodSync(cache, 0o600);
}
async function request(fetchImpl: FetchLike, url: string, init: RequestInit, timeoutMs: number, responseKind: 'json' | 'text' = 'json'): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new GarminHttpError(response.status, 'http');
    if (response.status === 204) return null;
    try { return responseKind === 'text' ? await response.text() : await response.json(); } catch { throw new GarminHttpError(response.status, 'malformed'); }
  } catch (error) {
    if (error instanceof GarminHttpError) throw error;
    if ((error as { name?: string }).name === 'AbortError') throw new GarminHttpError(0, 'timeout');
    throw new GarminHttpError(0, 'http');
  } finally { clearTimeout(timer); }
}
async function authenticate(fetchImpl: FetchLike, keyFile: string, cache: string, baseUrl: string, timeoutMs: number, now: Date, force = false): Promise<BearerToken> {
  let key: string;
  try { key = fs.readFileSync(keyFile, 'utf8').trim(); } catch { throw new Error('Garmin API key file cannot be read.'); }
  if (!key) throw new Error('Garmin API key is unavailable.');
  const keyFingerprint = fingerprint(key, baseUrl);
  if (!force) {
    const cached = loadToken(cache, keyFingerprint, now);
    if (cached) return cached;
  }
  const raw = await request(fetchImpl, `${baseUrl}${TOKEN_PATH}`, { method: 'POST', headers: { Accept: '*/*', Authorization: `ApiKey ${key}` } }, timeoutMs, 'text');
  if (typeof raw !== 'string') throw new Error('Garmin token response was invalid.');
  const expiresAt = tokenExpiry(raw.trim());
  if (expiresAt === null) throw new Error('Garmin token response was invalid.');
  const token = { accessToken: raw.trim(), expiresAt, fingerprint: keyFingerprint };
  saveToken(cache, token);
  return token;
}
async function apiGet(fetchImpl: FetchLike, baseUrl: string, pathName: string, token: BearerToken, timeoutMs: number): Promise<unknown> {
  return request(fetchImpl, `${baseUrl}${pathName}`, { method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${token.accessToken}` } }, timeoutMs);
}
function rows(value: unknown): JsonRecord[] { return Array.isArray(value) ? value.map(record) : []; }
function mapRows(value: unknown, field = 'calendarDate'): Map<string, JsonRecord> {
  return new Map(rows(value).flatMap((row) => { const date = isoDate(row[field]); return date ? [[date, row] as [string, JsonRecord]] : []; }));
}
function bodyBatterySamples(row: JsonRecord): GarminBodyBatterySample[] {
  const descriptors = Array.isArray(row.bodyBatteryValueDescriptorDTOList) ? row.bodyBatteryValueDescriptorDTOList.map(record) : [];
  const timestampIndex = descriptors.findIndex((item) => /timestamp/i.test(String(item.bodyBatteryValueDescriptorKey ?? '')));
  const valueIndex = descriptors.findIndex((item) => /bodybattery/i.test(String(item.bodyBatteryValueDescriptorKey ?? '')));
  const pairs = Array.isArray(row.bodyBatteryValuesArray) ? row.bodyBatteryValuesArray : [];
  return pairs.flatMap((pair) => {
    if (!Array.isArray(pair)) return [];
    const timestamp = isoFromEpoch(pair[timestampIndex >= 0 ? timestampIndex : 0]);
    const value = numberOrNull(pair[valueIndex >= 0 ? valueIndex : 1]);
    return timestamp && value !== null && value >= 0 && value <= 100 ? [{ timestamp, value }] : [];
  });
}
function nearSleepEnd(samples: GarminBodyBatterySample[], sleepEnd: string | null): number | null {
  if (!sleepEnd) return null;
  const target = Date.parse(sleepEnd);
  if (Number.isNaN(target)) return null;
  const nearest = samples.map((sample) => ({ sample, diff: Math.abs(Date.parse(sample.timestamp) - target) })).sort((a, b) => a.diff - b.diff)[0];
  return nearest && nearest.diff <= 2 * 60 * 60 * 1000 ? nearest.sample.value : null;
}
function hrvForDate(payload: unknown, date: string): number | null {
  const candidates = rows(payload).filter((row) => isoDate(row.calendarDate) === date || isoDate(row.date) === date);
  for (const candidate of candidates) for (const key of ['hrvValue', 'weeklyAvg', 'lastNightAvg', 'value']) {
    const value = numberOrNull(candidate[key]); if (value !== null) return value;
  }
  return null;
}
function assertPayloadShapes(payloads: { body: unknown; sleep: unknown; stress: unknown; daily: unknown; weight: unknown; hrv: unknown }): void {
  if (!Array.isArray(payloads.body) || !Array.isArray(payloads.sleep) || !Array.isArray(payloads.stress)) throw new GarminHttpError(0, 'malformed');
  if (!Array.isArray(record(payloads.daily).data) || !Array.isArray(record(payloads.weight).dailyWeightSummaries)) throw new GarminHttpError(0, 'malformed');
  if (payloads.hrv !== null && !Array.isArray(payloads.hrv)) throw new GarminHttpError(0, 'malformed');
}
function normalize(sessionDate: string, fetchedAt: string, timeZone: string, payloads: { body: unknown; sleep: unknown; stress: unknown; daily: unknown; weight: unknown; hrv: unknown }): GarminWellnessContext {
  assertPayloadShapes(payloads);
  const body = mapRows(payloads.body, 'date'); const sleep = mapRows(payloads.sleep); const stress = mapRows(payloads.stress);
  const dailyRows = record(payloads.daily).data; const daily = mapRows(dailyRows); const weightRows = record(payloads.weight).dailyWeightSummaries;
  const weights = mapRows(weightRows, 'summaryDate');
  const days = Array.from({ length: 7 }, (_, index) => shiftDate(sessionDate, index - 6)).map((date) => {
    const s = sleep.get(date) ?? {}; const st = record((stress.get(date) ?? {}).values); const d = daily.get(date) ?? {}; const b = body.get(date) ?? {}; const bb = record(d.bodyBattery); const hr = record(d.heartRate);
    const samples = bodyBatterySamples(b); const latestWeight = record((weights.get(date) ?? {}).latestWeight); const rawWeight = numberOrNull(latestWeight.weight);
    const sleepStart = isoFromEpoch(s.sleepStartTimestampGMT ?? s.sleepStartTimestampLocal);
    const sleepEnd = isoFromEpoch(s.sleepEndTimestampGMT ?? s.sleepEndTimestampLocal);
    return {
      source: 'garmin_personal_api' as const, date, dataTimestamp: isoFromEpoch(d.wellnessChronology && record(d.wellnessChronology).endTimestampGMT),
      sleepDurationS: numberOrNull(s.sleepTimeSeconds), sleepScore: numberOrNull(record(s.sleepScores).overall && record(record(s.sleepScores).overall).value),
      deepSleepS: numberOrNull(s.deepSleepSeconds), lightSleepS: numberOrNull(s.lightSleepSeconds), remSleepS: numberOrNull(s.remSleepSeconds), awakeSleepS: numberOrNull(s.awakeSleepSeconds),
      sleepStart, sleepEnd, sleepStartLocal: localDateTime(sleepStart, timeZone), sleepEndLocal: localDateTime(sleepEnd, timeZone), sleepStress: numberOrNull(s.avgSleepStress),
      restingHeartRate: numberOrNull(hr.restingValue), heartRateMin: numberOrNull(hr.minValue), heartRateMax: numberOrNull(hr.maxValue), hrv: hrvForDate(payloads.hrv, date),
      stressLevel: numberOrNull(st.overallStressLevel), stressRestS: numberOrNull(st.restStressDuration), stressLowS: numberOrNull(st.lowStressDuration), stressMediumS: numberOrNull(st.mediumStressDuration), stressHighS: numberOrNull(st.highStressDuration),
      bodyBatteryLatest: numberOrNull(bb.latestValue), bodyBatteryMin: numberOrNull(bb.minValue), bodyBatteryMax: numberOrNull(bb.maxValue), bodyBatteryMorning: nearSleepEnd(samples, sleepEnd), bodyBatteryCharged: numberOrNull(b.charged ?? bb.chargedValue), bodyBatteryDrained: numberOrNull(b.drained ?? bb.drainedValue), bodyBatterySamples: samples,
      weightKg: rawWeight === null ? null : rawWeight / 1000, weightMeasuredAt: isoFromEpoch(latestWeight.timestampGMT),
    };
  });
  return { source: 'garmin_personal_api', provenance: 'garmin_personal_api_wellness', availability: 'fresh', sessionDate, timeZone, fetchedAt, lastSuccessfulFetch: fetchedAt, failureReason: null, keyExpiryStatus: 'ok', days, sessionDay: days.find((day) => day.date === sessionDate) ?? null };
}

/** Reads only documented Garmin Personal API endpoints; raw payloads are never written to disk. */
export async function getGarminWellnessContext(options: GarminWellnessOptions): Promise<GarminWellnessContext> {
  const enabled = options.enabled ?? config.garminWellnessEnabled;
  const timeZone = options.timeZone ?? config.garminWellnessTimeZone;
  const now = (options.now ?? (() => new Date()))(); const cached = readCached(options.storageDir, options.sessionDate);
  const keyStatus = keyExpiryStatus(options.keyExpiresOn ?? config.garminPersonalApiKeyExpiresOn, now);
  if (!enabled) return unavailable(options.sessionDate, timeZone, keyStatus);
  if (keyStatus === 'expired') return cached ? { ...cached, availability: 'stale', failureReason: 'key_expired', keyExpiryStatus: keyStatus, lastSuccessfulFetch: cached.fetchedAt } : unavailable(options.sessionDate, timeZone, keyStatus, 'key_expired');
  if (cached && fresh(cached, now)) return { ...cached, lastSuccessfulFetch: cached.fetchedAt, failureReason: null, keyExpiryStatus: keyStatus };
  const fetchImpl = options.fetchImpl ?? fetch; const baseUrl = (options.baseUrl ?? config.garminPersonalApiBaseUrl).replace(/\/$/, ''); const timeoutMs = options.timeoutMs ?? config.garminWellnessTimeoutMs;
  const keyFile = options.keyFile ?? config.garminPersonalApiKeyFile; const tokenCache = options.tokenCacheFile ?? config.garminPersonalBearerTokenCacheFile;
  const totalTimeoutMs = options.totalTimeoutMs ?? config.garminWellnessTotalTimeoutMs;
  const deadline = Date.now() + Math.max(1, totalTimeoutMs);
  const remainingTimeout = (): number => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new GarminHttpError(0, 'timeout');
    return Math.min(timeoutMs, remaining);
  };
  const oldest = shiftDate(options.sessionDate, -6);
  try {
    let token = await authenticate(fetchImpl, keyFile, tokenCache, baseUrl, remainingTimeout(), now);
    // Deliberately sequential: six small range requests are gentler than a burst
    // and avoid introducing a rate-limit queue into brief generation.
    const requestAll = async () => [
      await apiGet(fetchImpl, baseUrl, `/wellness-service/wellness/bodyBattery/reports/daily?startDate=${oldest}&endDate=${options.sessionDate}&chunks=1`, token, remainingTimeout()),
      await apiGet(fetchImpl, baseUrl, `/sleep-service/sleep/dailySleepSummariesByDate?startDate=${oldest}&endDate=${options.sessionDate}`, token, remainingTimeout()),
      await apiGet(fetchImpl, baseUrl, `/usersummary-service/stats/stress/daily/${oldest}/${options.sessionDate}`, token, remainingTimeout()),
      await apiGet(fetchImpl, baseUrl, `/usersummary-service/v2/dailysummaries?startDate=${oldest}&endDate=${options.sessionDate}`, token, remainingTimeout()),
      await apiGet(fetchImpl, baseUrl, `/weight-service/weight/range/${oldest}/${options.sessionDate}?includeAll=true`, token, remainingTimeout()),
      await apiGet(fetchImpl, baseUrl, `/hrv-service/hrv/daily/${oldest}/${options.sessionDate}`, token, remainingTimeout()),
    ];
    let values: unknown[];
    try { values = await requestAll(); } catch (error) {
      if (!(error instanceof GarminHttpError) || error.status !== 401) throw error;
      token = await authenticate(fetchImpl, keyFile, tokenCache, baseUrl, remainingTimeout(), now, true); values = await requestAll();
    }
    const context = normalize(options.sessionDate, now.toISOString(), timeZone, { body: values[0], sleep: values[1], stress: values[2], daily: values[3], weight: values[4], hrv: values[5] });
    context.keyExpiryStatus = keyStatus;
    writeCached(options.storageDir, context); return context;
  } catch (error) {
    const failureReason: GarminFailureReason = error instanceof GarminHttpError
      ? (error.status === 401 || error.status === 403 ? 'authentication_failed' : error.status === 429 ? 'rate_limited' : error.kind === 'timeout' ? 'timed_out' : error.kind === 'malformed' ? 'malformed_response' : 'service_unavailable')
      : 'service_unavailable';
    if (cached) return { ...cached, availability: 'stale', failureReason, keyExpiryStatus: keyStatus, lastSuccessfulFetch: cached.fetchedAt };
    return unavailable(options.sessionDate, timeZone, keyStatus, failureReason);
  }
}
