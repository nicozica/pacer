import * as assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getGarminWellnessContext } from './garmin-wellness';

const SESSION = '2026-10-22';
const NOW = new Date('2026-10-23T12:00:00.000Z');
const token = (expiration = '2026-10-30T00:00:00.000Z') => `x.${Buffer.from(JSON.stringify({ exp: Date.parse(expiration) / 1000 })).toString('base64url')}.y`;
const response = (value: unknown, status = 200) => new Response(typeof value === 'string' ? value : JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

function payload(url: string, mode: 'normal' | 'empty' | 'malformed' = 'normal'): unknown {
  if (url.includes('/personal-api-key/token')) return token();
  if (mode === 'malformed' && url.includes('bodyBattery')) return {};
  if (mode === 'empty') {
    if (url.includes('dailysummaries')) return { data: [] };
    if (url.includes('weight/range')) return { dailyWeightSummaries: [] };
    if (url.includes('/hrv/')) return null;
    return [];
  }
  if (url.includes('bodyBattery')) return [{ date: SESSION, charged: 65, drained: 30, bodyBatteryValueDescriptorDTOList: [{ bodyBatteryValueDescriptorKey: 'timestamp' }, { bodyBatteryValueDescriptorKey: 'bodyBattery' }], bodyBatteryValuesArray: [[Date.parse('2026-10-22T05:00:00Z'), 72]] }];
  if (url.includes('dailySleepSummaries')) return [{ calendarDate: SESSION, sleepTimeSeconds: 25_200, deepSleepSeconds: 4_200, lightSleepSeconds: 12_000, remSleepSeconds: 8_400, awakeSleepSeconds: 600, sleepStartTimestampGMT: Date.parse('2026-10-21T23:00:00Z'), sleepEndTimestampGMT: Date.parse('2026-10-22T05:00:00Z'), avgSleepStress: 18, sleepScores: { overall: { value: 82 } } }];
  if (url.includes('/stress/')) return [{ calendarDate: SESSION, values: { overallStressLevel: 26, restStressDuration: 12_000, lowStressDuration: 6_000, mediumStressDuration: 3_000, highStressDuration: 900 } }];
  if (url.includes('dailysummaries')) return { data: [{ calendarDate: SESSION, wellnessChronology: { endTimestampGMT: '2026-10-22T23:59:00Z' }, bodyBattery: { latestValue: 45, minValue: 30, maxValue: 80 }, heartRate: { restingValue: 49, minValue: 45, maxValue: 162 } }] };
  if (url.includes('weight/range')) return { dailyWeightSummaries: [{ summaryDate: SESSION, numOfWeightEntries: 2, latestWeight: { weight: 80_100, timestampGMT: Date.parse('2026-10-22T07:00:00Z') }, allWeightMetrics: [{ weight: 79_900 }, { weight: 80_100 }] }] };
  if (url.includes('/hrv/')) return null;
  throw new Error(`Unexpected URL ${url}`);
}

function fixture(mode: 'normal' | 'empty' | 'malformed' = 'normal', firstDataStatus: number | null = null) {
  const calls: string[] = []; let dataCalls = 0;
  const fetchImpl = async (input: string): Promise<Response> => {
    calls.push(input);
    if (!input.includes('/personal-api-key/token')) { dataCalls += 1; if (firstDataStatus && dataCalls === 1) return response({ ignored: true }, firstDataStatus); }
    if (input.includes('/hrv/') && mode === 'normal') return new Response(null, { status: 204 });
    return response(payload(input, mode));
  };
  return { calls, fetchImpl };
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pacer-garmin-test-'));
  const keyFile = path.join(root, 'key'); const tokenCache = path.join(root, 'token.json');
  fs.writeFileSync(keyFile, 'fixture-only-key\n', { mode: 0o600 });
  const options = { sessionDate: SESSION, storageDir: root, enabled: true, keyFile, tokenCacheFile: tokenCache, baseUrl: 'https://garmin.test', now: () => NOW };
  try {
    let disabledCalls = 0;
    const disabled = await getGarminWellnessContext({ ...options, enabled: false, fetchImpl: async () => { disabledCalls += 1; throw new Error('must not fetch'); } });
    assert.equal(disabled.availability, 'unavailable'); assert.equal(disabledCalls, 0, 'disabled provider does not read credentials or request Garmin');
    const keyWarning = await getGarminWellnessContext({ ...options, enabled: false, keyExpiresOn: '2026-10-29', fetchImpl: async () => { throw new Error('must not fetch'); } });
    assert.equal(keyWarning.keyExpiryStatus, 'expires_within_7_days');
    let expiredKeyCalls = 0;
    const expiredKeyContext = await getGarminWellnessContext({ ...options, keyExpiresOn: '2026-10-01', fetchImpl: async () => { expiredKeyCalls += 1; throw new Error('must not fetch'); } });
    assert.equal(expiredKeyContext.availability, 'unavailable'); assert.equal(expiredKeyContext.failureReason, 'key_expired'); assert.equal(expiredKeyCalls, 0, 'configured expired key never blocks fallback with a network request');
    const normal = fixture();
    const context = await getGarminWellnessContext({ ...options, fetchImpl: normal.fetchImpl });
    assert.equal(context.availability, 'fresh');
    assert.equal(context.sessionDay?.weightKg, 80.1, 'Garmin grams normalize to kg');
    assert.equal(context.sessionDay?.hrv, null, 'null HRV remains null');
    assert.equal(context.sessionDay?.bodyBatteryMorning, 72, 'morning battery is sampled near sleep end');
    assert.equal(context.sessionDay?.bodyBatteryLatest, 45, 'latest is kept separate from waking recovery');
    assert.equal(context.sessionDay?.sleepEndLocal, '2026-10-22 02:00', 'sleep clock is normalized in the athlete timezone');
    assert.equal(normal.calls.filter((url) => url.includes('personal-api-key/token')).length, 1, normal.calls.join(','));

    const cached = fixture();
    const fromCache = await getGarminWellnessContext({ ...options, fetchImpl: cached.fetchImpl });
    assert.equal(fromCache.availability, 'fresh'); assert.equal(cached.calls.length, 0, 'fresh cache avoids requests');

    const expiredRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pacer-garmin-expired-')); const expiredKey = path.join(expiredRoot, 'key'); const expiredCache = path.join(expiredRoot, 'token');
    fs.writeFileSync(expiredKey, 'fixture-only-key', { mode: 0o600 });
    const expiredFingerprint = crypto.createHash('sha256').update('https://garmin.test\0fixture-only-key').digest('hex');
    fs.writeFileSync(expiredCache, JSON.stringify({ fingerprint: expiredFingerprint, access_token: token('2026-10-22T00:00:00Z'), expires_at: Date.parse('2026-10-22T00:00:00Z') }), { mode: 0o600 });
    const expired = fixture(); const renewed = await getGarminWellnessContext({ ...options, storageDir: expiredRoot, keyFile: expiredKey, tokenCacheFile: expiredCache, fetchImpl: expired.fetchImpl });
    assert.equal(renewed.availability, 'fresh'); assert.equal(expired.calls.filter((url) => url.includes('personal-api-key/token')).length, 1, 'expired JWT renews before data reads'); fs.rmSync(expiredRoot, { recursive: true, force: true });

    const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pacer-garmin-empty-')); fs.writeFileSync(path.join(emptyRoot, 'key'), 'fixture-only-key', { mode: 0o600 });
    const empty = fixture('empty'); const emptyContext = await getGarminWellnessContext({ ...options, storageDir: emptyRoot, keyFile: path.join(emptyRoot, 'key'), tokenCacheFile: path.join(emptyRoot, 'token'), fetchImpl: empty.fetchImpl });
    assert.equal(emptyContext.availability, 'fresh'); assert.equal(emptyContext.sessionDay?.sleepScore, null);
    fs.rmSync(emptyRoot, { recursive: true, force: true });

    const malformedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pacer-garmin-malformed-')); fs.writeFileSync(path.join(malformedRoot, 'key'), 'fixture-only-key', { mode: 0o600 });
    const malformed = fixture('malformed'); const bad = await getGarminWellnessContext({ ...options, storageDir: malformedRoot, keyFile: path.join(malformedRoot, 'key'), tokenCacheFile: path.join(malformedRoot, 'token'), fetchImpl: malformed.fetchImpl });
    assert.equal(bad.availability, 'unavailable', 'malformed payload is not trusted'); fs.rmSync(malformedRoot, { recursive: true, force: true });

    const stale = fixture('normal', 429);
    const staleContext = await getGarminWellnessContext({ ...options, fetchImpl: stale.fetchImpl, now: () => new Date('2026-10-23T19:00:01.000Z') });
    assert.equal(staleContext.availability, 'stale', 'rate limiting preserves a useful normalized cache');

    const retryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pacer-garmin-401-')); fs.writeFileSync(path.join(retryRoot, 'key'), 'fixture-only-key', { mode: 0o600 });
    const retry = fixture('normal', 401); const retried = await getGarminWellnessContext({ ...options, storageDir: retryRoot, keyFile: path.join(retryRoot, 'key'), tokenCacheFile: path.join(retryRoot, 'token'), fetchImpl: retry.fetchImpl });
    assert.equal(retried.availability, 'fresh'); assert.equal(retry.calls.filter((url) => url.includes('personal-api-key/token')).length, 2, '401 forces exactly one token renewal'); fs.rmSync(retryRoot, { recursive: true, force: true });

    const authRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pacer-garmin-auth-')); fs.writeFileSync(path.join(authRoot, 'key'), 'fixture-only-key', { mode: 0o600 });
    const authFailed = await getGarminWellnessContext({ ...options, storageDir: authRoot, keyFile: path.join(authRoot, 'key'), tokenCacheFile: path.join(authRoot, 'token'), fetchImpl: async () => response({}, 401) });
    assert.equal(authFailed.availability, 'unavailable'); assert.equal(authFailed.failureReason, 'authentication_failed'); fs.rmSync(authRoot, { recursive: true, force: true });

    const timeoutRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pacer-garmin-timeout-')); fs.writeFileSync(path.join(timeoutRoot, 'key'), 'fixture-only-key', { mode: 0o600 });
    const timeout = async (_input: string, init?: RequestInit) => new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    const timedOut = await getGarminWellnessContext({ ...options, storageDir: timeoutRoot, keyFile: path.join(timeoutRoot, 'key'), tokenCacheFile: path.join(timeoutRoot, 'token'), fetchImpl: timeout, timeoutMs: 1 });
    assert.equal(timedOut.availability, 'unavailable'); fs.rmSync(timeoutRoot, { recursive: true, force: true });
    console.log('Garmin wellness regression checks passed.');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
