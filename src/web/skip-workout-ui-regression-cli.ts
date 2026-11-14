/* Browser regression for the Skip Workout UI and standalone future-workout-v1 import. Every /api
 * call is mocked in-page: no Pacer backend, Intervals.icu, Garmin, deploy or database is touched. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium, type Page } from 'playwright';

const WEB = path.resolve(__dirname, '../../web');
const SOURCE_ID = 198651687;
const ID = 'wk-skip';
const BRIEF = 'SKIP TRAINING BRIEF\nPlanned workout: Easy run (wk-skip)\nPlanning anchor: completed activity 198651687.';
const lifecycle = (over: Record<string, unknown> = {}) => ({
  approvalStatus: 'approved', approvedAt: 'now', approvalNote: null, syncStatus: 'synced',
  syncedAt: 'now', intervalsEventId: '77', lastSyncError: null, ...over,
});
const workout = (over: Record<string, unknown> = {}, lc: Record<string, unknown> = {}) => ({
  contractVersion: 'future-workout-v1', pacerWorkoutId: ID, proposalKey: 'k', proposalRevision: 1,
  proposedAt: '2026-10-18T00:00:00Z', updatedAt: '2026-10-18T00:00:00Z',
  sourceSession: { sourceActivityId: SOURCE_ID, sessionDate: '2026-10-18' },
  schedule: { localDate: '2099-10-25', timezone: 'America/Argentina/Buenos_Aires' },
  workoutType: 'Easy Run', title: 'Easy run', coachingNotes: '',
  blocks: [{ kind: 'work', label: 'Easy', duration: { unit: 'time', seconds: 2700 }, target: { kind: 'unrestricted' } }],
  lifecycle: lifecycle(lc), intervalsEventKey: 'x', ...over,
});
const snapshot = {
  collectedAt: '2026-11-14T08:00:00Z',
  intervals: { source: 'intervals', provenance: 'intervals_athlete_wellness', sessionDate: '2099-10-25', fetchedAt: 'x', recent: {}, sessionDay: { updatedAt: '2026-11-14T06:00:00Z', sleepDurationS: 25200, sleepScore: 71, restingHeartRate: null, hrv: 48 } },
  garmin: { provenance: 'garmin_personal_api_wellness', availability: 'stale', fetchedAt: '2026-11-13T06:00:00Z', failureReason: null, keyExpiryStatus: 'ok', sessionDay: { dataTimestamp: '2026-11-13T06:00:00Z', sleepStart: '2026-11-13T01:10:00Z', sleepEnd: '2026-11-13T09:05:00Z', sleepStartLocal: '2026-11-12T22:10:00', sleepEndLocal: '2026-11-13T06:05:00', sleepDurationS: null, sleepScore: 66, bodyBatteryMorning: null, hrv: null } },
  availability: { intervals: 'available', garmin: 'stale' },
};
const skipRecord = (over: Record<string, unknown> = {}) => ({
  explanation: 'Calf felt tight', skippedAt: '2026-11-14T08:00:00Z', wellnessSnapshot: snapshot,
  wellnessCollectedAt: '2026-11-14T08:00:00Z', wellnessProvenance: {}, conflictActivityId: null, conflictDetectedAt: null, ...over,
});

interface Mock {
  workouts: Array<ReturnType<typeof workout>>;
  skips: Record<string, ReturnType<typeof skipRecord>>;
  previewFails: boolean; anchorId: number; sleepScore: number; eligible: boolean; importError: string; failSync: boolean; failPublish: boolean; completeError: string; skipFails: boolean; calls: string[]; bodies: Record<string, unknown>;
}
const newMock = (over: Partial<Mock> = {}): Mock => ({ workouts: [workout()], skips: {}, previewFails: false, anchorId: SOURCE_ID, sleepScore: 71, eligible: true, importError: '', failSync: false, failPublish: false, completeError: '', skipFails: false, calls: [], bodies: {}, ...over });

function bootstrap() {
  return {
    recentRuns: [{ sourceActivityId: SOURCE_ID, sessionDate: '2026-10-18', title: 'Run', rawActivityName: null, displayActivityName: null, workoutCode: null, sessionTypeSuggestion: null, distanceKm: 8, movingTimeLabel: '50:00', savedSessionId: 1, savedSessionMatchedBy: 'id', savedSignalTitle: null }],
    latestPublishedAt: null,
    selectedSession: {
      selectedSourceActivityId: SOURCE_ID, publication: { state: 'draft', publishedAt: null, attemptedAt: null, message: null }, savedSessionId: 1,
      source: { sourceActivityId: SOURCE_ID, sessionDate: '2026-10-18', title: 'Run', rawActivityName: null, displayActivityName: null, workoutCode: null, sessionTypeSuggestion: null, sport: 'Run', source: 's', distanceKm: 8, movingTimeLabel: '50:00', elapsedTimeLabel: null, paceLabel: null, hrLine: null, elevationLabel: null, weatherLine: null, city: null },
      manual: { sessionType: '', legs: '', sleepScore: null, restedness: '', extraNotes: '' },
      files: { tcxFilename: '', tcxAttached: false, briefFilename: '' },
      ai: { sourceActivityId: SOURCE_ID, sessionDate: '2026-10-18', signalTitle: '', signalParagraphs: [], carryForward: '', nextRunTitle: '', nextRunSummary: '', nextRunDurationMin: null, nextRunDurationMax: null, nextRunDistanceKm: null, nextRunPaceMinSecPerKm: null, nextRunPaceMaxSecPerKm: null, weekTitle: '', weekSummary: '' }, laps: [], lapSource: 'none', intervalsSegments: [], garminDeviceLaps: [], wellness: null, updatedAt: null,
    },
  };
}

const record = (mock: Mock, w: ReturnType<typeof workout>) => {
  const skip = mock.skips[w.pacerWorkoutId] ?? null;
  return { workout: w, revisions: [], preview: [], skip, outcomeStatus: skip?.conflictActivityId ? 'completed_after_skip' : skip ? 'skipped' : 'scheduled', completedAfterSkipActivityId: skip?.conflictActivityId ?? null };
};

async function install(page: Page, mock: Mock) {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const key = `${route.request().method()} ${url.pathname}`;
    mock.calls.push(key);
    const post = route.request().postData();
    if (post) mock.bodies[key] = JSON.parse(post);
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (key === 'GET /api/editor/bootstrap') return json(200, bootstrap());
    if (key === 'GET /api/latest') return json(200, { fetchedAt: null, latestActivity: null, latestRun: null, latestRide: null, last7days: { totalTimeMin: 0, count: 0, runCount: 0, totalRunKm: 0, rideCount: 0, totalRideKm: 0 } });
    if (key === 'GET /api/workouts') return json(200, { proposals: mock.workouts.map((w) => record(mock, w)) });
    const detailsFor = () => {
      const w = mock.workouts.find((x) => x.pacerWorkoutId === ID)!;
      const skip = mock.skips[ID] ?? null;
      return {
        workout: w, eligible: !skip && mock.eligible, eligibilityReason: skip ? 'This workout has already been skipped.' : mock.eligible ? null : 'A completed activity is already paired with this workout.',
        skip, outcomeStatus: skip?.conflictActivityId ? 'completed_after_skip' : skip ? 'skipped' : 'scheduled', completedAfterSkipActivityId: skip?.conflictActivityId ?? null,
        planningAnchor: { sourceActivityId: mock.anchorId, sessionDate: '2026-10-18', title: 'Run' }, brief: skip ? BRIEF : null,
      };
    };
    const liveSnapshot = () => ({ ...snapshot, intervals: { ...snapshot.intervals, sessionDay: { ...snapshot.intervals.sessionDay, sleepScore: mock.sleepScore } } });
    if (key === `GET /api/workouts/${ID}/skip-preview`) {
      if (mock.previewFails) return json(500, { error: 'Recovery service down.' });
      return json(200, { ...detailsFor(), skipIntentStatus: mock.skips[ID] ? 'persisted_skip' : 'intended_skip_not_persisted', recoveryPreview: liveSnapshot() });
    }
    if (key === `POST /api/workouts/${ID}/skip-preview`) {
      if (mock.previewFails) return json(500, { error: 'Recovery service down.' });
      const base = detailsFor();
      if (base.skip) return json(200, { ...base, skipIntentStatus: 'persisted_skip', recoveryPreview: liveSnapshot() });
      const expl = (JSON.parse(post || '{}') as { explanation?: string }).explanation ?? null;
      return json(200, { ...base, skipIntentStatus: 'intended_skip_not_persisted', recoveryPreview: liveSnapshot(),
        brief: `INTENDED SKIP BRIEF (not recorded)\nAthlete explanation: ${expl ?? 'not provided'}.\nPlanning anchor: completed activity ${mock.anchorId}.` });
    }
    if (key === `POST /api/workouts/${ID}/skip`) {
      const operation = mock.skips[ID] ? 'unchanged' : 'created';
      mock.skips[ID] ??= skipRecord({ explanation: (mock.bodies[key] as { explanation?: string }).explanation ?? null, wellnessSnapshot: liveSnapshot() });
      if (mock.skipFails) { delete mock.skips[ID]; return json(409, { error: 'Only approved workouts can be skipped.' }); }
      return json(200, { operation, details: detailsFor() });
    }
    if (key === `GET /api/workouts/${ID}/skip`) return json(200, detailsFor());
    if (key === 'POST /api/workouts/import') {
      const incoming = JSON.parse(post || '{}');
      if (mock.importError) return json(400, { error: mock.importError });
      const existing = mock.workouts.find((w) => w.pacerWorkoutId === incoming.pacerWorkoutId);
      if (!existing) mock.workouts.push(workout({ ...incoming }));
      return json(existing ? 200 : 201, { operation: existing ? 'unchanged' : 'created', proposal: record(mock, existing ?? mock.workouts[mock.workouts.length - 1]) });
    }
    if (key === `POST /api/workouts/${ID}/skip/complete`) {
      const body = JSON.parse(post || '{}') as { explanation?: string; futureWorkout: Record<string, unknown>; publishNextRun?: boolean };
      if (mock.skipFails) return json(409, { error: 'Only approved workouts can be skipped.' });
      const operation = mock.skips[ID] ? 'unchanged' : 'created';
      mock.skips[ID] ??= skipRecord({ explanation: body.explanation ?? null, wellnessSnapshot: liveSnapshot() });
      const existing = mock.workouts.find((w) => w.pacerWorkoutId === body.futureWorkout.pacerWorkoutId);
      // Real backend behaviour: re-importing a workout that is already approved conflicts.
      if (existing && existing.lifecycle.approvalStatus === 'approved') return json(400, { error: 'Future workout proposal conflicts with the stored revision.' });
      if (mock.completeError) return json(400, { error: mock.completeError });
      if (!existing) mock.workouts.push(workout({ ...body.futureWorkout }));
      const w = mock.workouts.find((x) => x.pacerWorkoutId === body.futureWorkout.pacerWorkoutId)!;
      w.lifecycle = lifecycle({ syncStatus: 'not_requested', syncedAt: null, intervalsEventId: null });
      const base = { skip: { operation }, imported: { operation: 'created', proposal: record(mock, w) }, approved: record(mock, w) };
      if (mock.failSync) {
        w.lifecycle = lifecycle({ syncStatus: 'failed', lastSyncError: 'Intervals calendar upsert failed (503).', syncedAt: null, intervalsEventId: null });
        return json(200, { complete: false, stage: 'sync', ...base, synchronized: record(mock, w), publicNextRun: null });
      }
      w.lifecycle = lifecycle();
      if (body.publishNextRun && mock.failPublish) return json(200, { complete: false, stage: 'publish', ...base, synchronized: record(mock, w), publicNextRun: { nextRun: {}, publishStatus: { ok: false, message: 'Build failed' } } });
      return json(200, { complete: true, stage: 'complete', ...base, synchronized: record(mock, w), publicNextRun: body.publishNextRun ? { nextRun: {}, publishStatus: { ok: true } } : null });
    }
    const publishMatch = url.pathname.match(/^\/api\/workouts\/([^/]+)\/publish-next-run$/);
    if (publishMatch) {
      return mock.failPublish ? json(502, { nextRun: {}, publishStatus: { ok: false, message: 'Build failed' } }) : json(200, { nextRun: {}, publishStatus: { ok: true } });
    }
    const match = url.pathname.match(/^\/api\/workouts\/([^/]+)\/(approve|sync)$/);
    if (match) {
      const w = mock.workouts.find((x) => x.pacerWorkoutId === decodeURIComponent(match[1]))!;
      if (match[2] === 'sync' && mock.failSync) { w.lifecycle = lifecycle({ syncStatus: 'failed', lastSyncError: 'Intervals calendar upsert failed (503).', syncedAt: null, intervalsEventId: null }); }
      else if (match[2] === 'approve') w.lifecycle = lifecycle({ syncStatus: 'not_requested', syncedAt: null, intervalsEventId: null });
      else w.lifecycle = lifecycle();
      return json(200, { proposal: record(mock, w) });
    }
    return json(404, { error: `unmocked ${key}` });
  });
}

const text = async (page: Page, sel: string) => ((await page.locator(sel).first().textContent()) || '').trim();
async function open(page: Page, base: string, mock: Mock) {
  page.on('pageerror', (error) => console.error('[pageerror]', error.message));
  await install(page, mock);
  await page.goto(base);
  await page.waitForFunction(() => (window as any).PacerWorkouts?.isLoaded());
  await page.waitForTimeout(150);
}

const NEW_ID = 'wk-new';
const newWorkout = (lc: Record<string, unknown> = { approvalStatus: 'proposed', syncStatus: 'not_requested', approvedAt: null, syncedAt: null, intervalsEventId: null }) =>
  workout({ pacerWorkoutId: NEW_ID, proposalKey: 'new', title: 'Recovery shakeout', workoutType: 'Recovery Run', schedule: { localDate: '2099-10-27', timezone: 'America/Argentina/Buenos_Aires' } }, lc);

async function main() {
  const server = http.createServer((req, res) => {
    const rel = (req.url || '/').split('?')[0];
    let file = path.join(WEB, rel === '/' ? 'index.html' : rel);
    if (file.startsWith(WEB) && fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!file.startsWith(WEB) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  }).listen(0);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
  const browser = await chromium.launch();
  const fresh = async (viewport = { width: 1100, height: 900 }) => {
    const context = await browser.newContext({ viewport });
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base.replace(/\/$/, '') });
    return context.newPage();
  };
  const openSkip = async (page: Page, mock: Mock, workoutId = ID) => {
    page.on('pageerror', (error) => console.error('[pageerror]', error.message));
    await install(page, mock);
    await page.goto(`${base}skip/?id=${workoutId}`);
    await page.waitForFunction(() => document.getElementById('skip-page-status')?.textContent !== 'Loading…');
  };
  const clip = (page: Page) => page.evaluate(() => navigator.clipboard.readText());
  const writes = (mock: Mock) => mock.calls.filter((c) => /^POST/.test(c) && !/refresh/.test(c));

  try {
    // Home: link (not a modal) beside Next workout; nothing skip-related fetched while rendering.
    {
      const page = await fresh(); const mock = newMock();
      await open(page, base, mock);
      assert.equal(await page.locator('dialog').count(), 0);
      assert.equal(mock.calls.some((c) => /skip/.test(c)), false, 'skip endpoints must not be called during normal rendering');
      await page.click('[data-skip-action="open"]');
      await page.waitForURL(`**/skip/?id=${ID}`);
      await page.waitForFunction(() => document.getElementById('skip-page-status')?.textContent === 'Not skipped yet');
      // Three steps only.
      assert.deepEqual(await page.locator('.coachat-step h3').allTextContents().then((t) => t.map((x) => x.replace(/\s+/g, ' ').trim().replace(/ (Intended|Skipped).*$/, ''))), ['1 Workout & Recovery', '2 Coachat Response', '3 Confirm, Sync & Publish']);
      // Step 1: details, recovery with provenance, freshness and sleep interval; no invented values.
      assert.match(await text(page, '#skip-workout'), /Easy run/);
      assert.match(await text(page, '#skip-workout'), /45 min|45m|0:45/i);
      const recovery = await text(page, '#skip-recovery');
      assert.match(recovery, /Intervals\.icu/); assert.match(recovery, /Garmin/);
      assert.match(recovery, /Sleep\s*7 h 00 min/); assert.match(recovery, /Resting HR\s*unavailable/i);
      assert.match(recovery, /Sleep scoreGarmin66Intervals\.icu71Sources differ/);
      assert.match(recovery, /Garmin data is stale/i); assert.match(recovery, /Body Battery \(morning\)\s*unavailable/i);
      assert.doesNotMatch(recovery, /2026-11-1\d/, 'timestamps are compact'); // interval needs Garmin sleep data: covered in the recovery layout test
      assert.match(recovery, /preview collected/i); assert.match(await text(page, '#skip-badge'), /Intended skip · not recorded/);
      // Brief + JSON are available BEFORE any skip is recorded, and nothing was persisted.
      assert.equal(await page.locator('#skip-copy-all').isDisabled(), false);
      assert.equal(await page.locator('#skip-confirm').count(), 0, 'no early confirmation step');
      assert.deepEqual(writes(mock).filter((c) => !/skip-preview/.test(c)), []);
      assert.equal(mock.skips[ID], undefined);
      // Explanation changes refresh the brief before copying (one extra preview call, body carries it).
      await page.fill('#skip-explanation', 'Calf felt tight');
      assert.match(await text(page, '#skip-brief-note'), /explanation changed/i);
      const previews = () => mock.calls.filter((c) => c === `POST /api/workouts/${ID}/skip-preview`).length;
      const before = previews();
      await page.click('#skip-copy-all');
      await page.waitForFunction(() => /copied/.test(document.getElementById('skip-copy-status')?.textContent || ''));
      assert.equal(previews(), before + 1);
      assert.deepEqual(mock.bodies[`POST /api/workouts/${ID}/skip-preview`], { explanation: 'Calf felt tight' });
      const all = await clip(page);
      assert.match(all, /^INTENDED SKIP BRIEF/); assert.match(all, /Athlete explanation: Calf felt tight\./);
      assert.match(all, /intended skip, not yet recorded/);
      const ctx = JSON.parse(all.slice(all.indexOf('{\n  "contractVersion"')));
      assert.equal(ctx.contractVersion, 'pacer-skip-context-v1'); assert.equal(ctx.status, 'intended_skip_not_persisted');
      assert.equal(ctx.explanation, 'Calf felt tight'); assert.equal(ctx.skippedAt, null);
      assert.equal(ctx.recovery.garmin.sessionDay.sleepStartLocal, '2026-11-12T22:10:00');
      assert.equal(ctx.recovery.garmin.provenance, 'garmin_personal_api_wellness');
      assert.equal(ctx.recovery.intervals.sessionDay.restingHeartRate, null);
      assert.ok(ctx.unavailable.includes('intervals.restingHeartRate') && ctx.unavailable.includes('garmin.bodyBatteryMorning'));
      assert.equal(ctx.planningAnchor.sourceActivityId, SOURCE_ID);
      assert.doesNotMatch(all, /keyExpiry|token|password/i);
      // Copying again with an unchanged explanation does not hit the providers again.
      await page.click('#skip-copy-all');
      await page.waitForFunction(() => /copied/.test(document.getElementById('skip-copy-status')?.textContent || ''));
      assert.equal(previews(), before + 1);
      // Step 2 does nothing on paste; step 3 shows the draft but nothing is recorded.
      await page.fill('#ai-json-input', JSON.stringify(newWorkout()));
      assert.match(await text(page, '#ai-import-status'), /Valid future-workout-v1/);
      assert.match(await text(page, '#skip-workout-preview'), /Recovery shakeout/);
      assert.deepEqual(writes(mock).filter((c) => !/skip-preview/.test(c)), [], 'pasting changes nothing');
      assert.equal(await text(page, '#btn-confirm'), 'Confirm, Sync & Publish');
      assert.equal(await page.locator('#btn-approve-sync').count(), 0, 'no separate Approve & Sync step');
      const explain = await text(page, '#skip-step-note');
      assert.match(explain, /records the skipped workout privately/); assert.match(explain, /cancels only its verified Pacer-owned planned Intervals\.icu event/); assert.match(explain, /before importing and approving/);
      assert.match(explain, /Intervals\.icu/); assert.match(explain, /public Next Run on run\.nico\.ar/); assert.match(explain, /stay private/);
      // One click (double-click submits once): the backend orchestration does skip -> import -> approve -> sync -> publish.
      await page.dblclick('#btn-confirm');
      await page.waitForFunction(() => /^Done\./.test(document.getElementById('save-banner')?.textContent || ''));
      const COMPLETE = `POST /api/workouts/${ID}/skip/complete`;
      assert.deepEqual(writes(mock).filter((c) => !/skip-preview/.test(c)), [COMPLETE], 'exactly one request; no individual skip/import/approve/sync calls');
      const sent = mock.bodies[COMPLETE] as Record<string, any>;
      assert.deepEqual(Object.keys(sent).sort(), ['explanation', 'futureWorkout', 'publishNextRun']);
      assert.equal(sent.explanation, 'Calf felt tight'); assert.equal(sent.publishNextRun, true);
      assert.deepEqual(sent.futureWorkout, JSON.parse(JSON.stringify(newWorkout())), 'the complete proposal is sent unchanged');
      const stages = await text(page, '#skip-stages');
      assert.match(stages, /Recorded privately/); assert.match(stages, /Imported and approved/); assert.match(stages, /Synced/); assert.match(stages, /Next Run published/);
      assert.equal(await text(page, '#skip-page-status'), 'Skipped');
      assert.equal(await text(page, '#workout-status-badge'), 'Sent to Intervals');
      assert.equal(await text(page, '#btn-confirm'), 'Published'); assert.equal(await page.locator('#btn-confirm').isDisabled(), true);
      assert.equal(await page.evaluate((k) => sessionStorage.getItem(k), `pacer-skip-draft:${ID}`), null, 'draft cleared only after full success');
      assert.equal(mock.calls.some((c) => /editor\/save/.test(c)), false);
      // Home: new Next workout; skipped one in history only.
      await page.click('.meta-link');
      await page.waitForFunction(() => /Recovery shakeout/.test(document.getElementById('coachat-workout-preview')?.textContent || ''));
      assert.match(await text(page, '#skipped-workouts'), /Easy run/);
    }

    // Reopen an existing skip: persisted record is authoritative, no re-confirmation, copy uses stored brief.
    {
      const page = await fresh(); const mock = newMock({ skips: { [ID]: skipRecord() } });
      await openSkip(page, mock);
      assert.equal(await text(page, '#skip-page-status'), 'Skipped');
      assert.match(await text(page, '#skip-recovery'), /snapshot stored when skipped/);
      assert.equal(await page.locator('#skip-explanation').inputValue(), 'Calf felt tight');
      assert.equal(await page.locator('#skip-explanation').isDisabled(), true);
      await page.click('#skip-copy-all');
      await page.waitForFunction(() => /copied/.test(document.getElementById('skip-copy-status')?.textContent || ''));
      const all = await clip(page);
      assert.ok(all.startsWith(BRIEF)); assert.doesNotMatch(all, /intended skip, not yet recorded/);
      assert.equal(JSON.parse(all.slice(all.indexOf('{\n  "contractVersion"'))).status, 'skipped');
      assert.equal(await page.locator('#ai-json-input').isDisabled(), false);
      assert.deepEqual(writes(mock).filter((c) => !/skip-preview/.test(c)), []);
    }

    // Preview consistency: refreshed context that differs is disclosed, never silently swapped.
    {
      const page = await fresh(); const mock = newMock();
      await openSkip(page, mock);
      await page.fill('#skip-explanation', 'one');
      await page.click('#skip-copy-all');
      await page.waitForFunction(() => /copied/.test(document.getElementById('skip-copy-status')?.textContent || ''));
      assert.equal(await page.locator('#skip-change-note').isVisible(), false);
      mock.sleepScore = 40; mock.anchorId = 777;
      await page.fill('#skip-explanation', 'two');
      await page.click('#skip-copy-all');
      await page.waitForFunction(() => !document.getElementById('skip-change-note')?.classList.contains('hidden'));
      const note = await text(page, '#skip-change-note');
      assert.match(note, /planning anchor 198651687 → 777/); assert.match(note, /recovery data/);
      // Confirming after the context moved on again is disclosed against what was copied.
      mock.sleepScore = 10;
      await page.fill('#ai-json-input', JSON.stringify(newWorkout()));
      await page.click('#btn-confirm');
      await page.waitForFunction(() => /^Done\./.test(document.getElementById('save-banner')?.textContent || ''));
      assert.match(await text(page, '#skip-change-note'), /Confirmed record: recovery data changed.*differs from the context you copied/s);
    }

    // Preview failure and ineligible workouts: clear message, nothing to confirm.
    {
      const page = await fresh(); const mock = newMock({ previewFails: true });
      await openSkip(page, mock);
      assert.match(await text(page, '#error-banner'), /Recovery service down/);
      assert.equal(await page.locator('#btn-confirm').isDisabled(), true);
    }
    {
      const page = await fresh(); const mock = newMock({ eligible: false });
      await openSkip(page, mock);
      assert.match(await text(page, '#skip-workout'), /already paired/);
      assert.equal(await page.locator('#skip-copy-all').isDisabled(), true);
      assert.equal(await page.locator('#ai-json-input').isDisabled(), true);
      assert.equal(await page.locator('#btn-confirm').isDisabled(), true);
    }

    // Unapproved / syncing workouts offer no skip link on the home screen.
    for (const lc of [{ approvalStatus: 'proposed', syncStatus: 'not_requested' }, { syncStatus: 'syncing' }]) {
      const page = await fresh(); const mock = newMock({ workouts: [workout({}, lc)] });
      await open(page, base, mock);
      assert.equal(await page.locator('[data-skip-action="open"]').count(), 0);
    }

    // Conflict: visible warning, nothing resolved.
    {
      const page = await fresh(); const mock = newMock({ skips: { [ID]: skipRecord({ conflictActivityId: 555 }) } });
      await openSkip(page, mock);
      assert.match(await text(page, '#skip-workout'), /activity 555 was completed.*not changed either record/s);
      assert.match(await text(page, '#skip-badge'), /activity found/);
      assert.deepEqual(writes(mock).filter((c) => !/skip-preview/.test(c)), []);
    }

    // Invalid input: nothing enables the final confirmation.
    {
      const page = await fresh(); const mock = newMock();
      await openSkip(page, mock);
      const status = () => text(page, '#ai-import-status');
      await page.fill('#ai-json-input', '{ nope');
      assert.match(await status(), /Not valid JSON/); assert.equal(await page.locator('#btn-confirm').isDisabled(), true);
      await page.fill('#ai-json-input', JSON.stringify({ contractVersion: 'coachat-response-v1' }));
      assert.match(await status(), /unified coachat-response-v1/); assert.equal(await page.locator('#btn-confirm').isDisabled(), true);
      await page.fill('#ai-json-input', JSON.stringify(workout()));
      assert.match(await status(), /skipped workout itself/); assert.equal(await page.locator('#btn-confirm').isDisabled(), true);
      // Draft survives navigation.
      const draft = JSON.stringify(newWorkout());
      await page.fill('#ai-json-input', draft);
      await page.goto(base); await page.goBack();
      await page.waitForFunction(() => document.getElementById('skip-page-status')?.textContent === 'Not skipped yet');
      assert.equal(await page.locator('#ai-json-input').inputValue(), draft);
      assert.equal(await page.locator('#btn-confirm').isDisabled(), false);
      assert.deepEqual(writes(mock).filter((c) => !/skip-preview/.test(c)), []);
    }

    const COMPLETE = `POST /api/workouts/${ID}/skip/complete`;
    const count = (mock: Mock, call: string) => mock.calls.filter((c) => c === call).length;

    // Partial success: skip recorded, import rejected -> real state shown, input kept, retry never re-skips twice in effect.
    {
      const page = await fresh(); const mock = newMock({ completeError: 'Future workout schedule.localDate must be a date.' });
      await openSkip(page, mock);
      await page.fill('#skip-explanation', 'Calf felt tight');
      const draft = JSON.stringify(newWorkout());
      await page.fill('#ai-json-input', draft);
      await page.click('#btn-confirm');
      await page.waitForFunction(() => /Completion stopped/.test(document.getElementById('error-banner')?.textContent || ''));
      assert.match(await text(page, '#error-banner'), /schedule\.localDate/);
      assert.match(await text(page, '#skip-stages'), /Skip\s*Recorded privately/); assert.match(await text(page, '#skip-stages'), /Replacement\s*Not imported/);
      assert.equal(await text(page, '#skip-page-status'), 'Skipped');
      assert.equal(await page.locator('#ai-json-input').inputValue(), draft, 'JSON preserved');
      assert.equal(await page.locator('#skip-explanation').inputValue(), 'Calf felt tight', 'explanation preserved');
      assert.equal(await text(page, '#btn-confirm'), 'Confirm, Sync & Publish'); assert.equal(await page.locator('#btn-confirm').isDisabled(), false);
      mock.completeError = '';
      await page.click('#btn-confirm');
      await page.waitForFunction(() => /^Done\./.test(document.getElementById('save-banner')?.textContent || ''));
      assert.equal(count(mock, COMPLETE), 2);
    }

    // Skip itself fails: nothing else is recorded, input kept.
    {
      const page = await fresh(); const mock = newMock({ skipFails: true });
      await openSkip(page, mock);
      await page.fill('#ai-json-input', JSON.stringify(newWorkout()));
      await page.click('#btn-confirm');
      await page.waitForFunction(() => /Only approved workouts can be skipped/.test(document.getElementById('error-banner')?.textContent || ''));
      assert.equal(mock.workouts.length, 1, 'nothing imported');
      assert.equal(await text(page, '#skip-page-status'), 'Not skipped yet');
      assert.notEqual(await page.locator('#ai-json-input').inputValue(), '');
    }

    // Sync fails: skip + replacement are kept, stages say so, retry only syncs (and publishes) - never the whole flow.
    {
      const page = await fresh(); const mock = newMock({ failSync: true });
      await openSkip(page, mock);
      const draft = JSON.stringify(newWorkout());
      await page.fill('#ai-json-input', draft);
      await page.click('#btn-confirm');
      await page.waitForFunction(() => /Intervals\.icu sync failed/.test(document.getElementById('error-banner')?.textContent || ''));
      const stages = await text(page, '#skip-stages');
      assert.match(stages, /Skip\s*Recorded privately/); assert.match(stages, /Imported and approved/); assert.match(stages, /Sync failed: Intervals calendar upsert failed/); assert.match(stages, /run\.nico\.ar\s*Not started/);
      assert.equal(await text(page, '#workout-status-badge'), 'Sync failed');
      assert.equal(await page.locator('#ai-json-input').inputValue(), draft);
      assert.equal(await text(page, '#btn-confirm'), 'Retry sync & publish');
      // Retry while it still fails: only /sync, error shown, nothing else repeated.
      await page.click('#btn-confirm');
      await page.waitForFunction(() => /Sync failed/.test(document.getElementById('error-banner')?.textContent || ''));
      assert.equal(count(mock, COMPLETE), 1, 'the full flow is never re-posted (it would conflict on the approved workout)');
      assert.equal(count(mock, `POST /api/workouts/${NEW_ID}/sync`), 1);
      mock.failSync = false;
      await page.click('#btn-confirm');
      await page.waitForFunction(() => /Public Next Run published/.test(document.getElementById('save-banner')?.textContent || ''));
      assert.equal(count(mock, COMPLETE), 1); assert.equal(count(mock, `POST /api/workouts/${NEW_ID}/sync`), 2);
      assert.equal(count(mock, `POST /api/workouts/${NEW_ID}/publish-next-run`), 1);
      assert.equal(count(mock, `POST /api/workouts/${ID}/skip`), 0); assert.equal(mock.calls.some((c) => /\/(approve|import)$/.test(c)), false);
      assert.match(await text(page, '#skip-stages'), /Next Run published/); assert.equal(await text(page, '#btn-confirm'), 'Published');
    }

    // Publication fails after a successful sync: shown as partial success; retry only publishes.
    {
      const page = await fresh(); const mock = newMock({ failPublish: true });
      await openSkip(page, mock);
      await page.fill('#skip-explanation', 'private reason');
      await page.fill('#ai-json-input', JSON.stringify(newWorkout()));
      await page.click('#btn-confirm');
      await page.waitForFunction(() => /publishing the public Next Run failed/.test(document.getElementById('error-banner')?.textContent || ''));
      const stages = await text(page, '#skip-stages');
      assert.match(stages, /Intervals\.icu\s*Synced/); assert.match(stages, /Not published: Build failed/);
      assert.equal(await text(page, '#workout-status-badge'), 'Sent to Intervals', 'not presented as a total failure');
      assert.equal(await text(page, '#btn-confirm'), 'Publish Next Run');
      await page.click('#btn-confirm'); // still failing: 502 body message is used
      await page.waitForFunction(() => /Publishing failed: Build failed/.test(document.getElementById('error-banner')?.textContent || ''));
      mock.failPublish = false;
      await page.click('#btn-confirm');
      await page.waitForFunction(() => /Public Next Run published/.test(document.getElementById('save-banner')?.textContent || ''));
      assert.equal(count(mock, COMPLETE), 1); assert.equal(count(mock, `POST /api/workouts/${NEW_ID}/publish-next-run`), 2);
      assert.equal(mock.calls.some((c) => /\/sync$|\/approve$/.test(c)), false, 'sync/approve never repeated');
      // Public publishing requests carry nothing private.
      assert.deepEqual(mock.bodies[`POST /api/workouts/${NEW_ID}/publish-next-run`], {});
      assert.doesNotMatch(JSON.stringify(mock.bodies[`POST /api/workouts/${NEW_ID}/publish-next-run`]), /private|recovery|wellness|explanation/i);
    }

    // Already skipped + replacement already synced: the page offers publish-only and never re-runs earlier stages.
    {
      const synced = workout({ pacerWorkoutId: NEW_ID, proposalKey: 'new', title: 'Recovery shakeout', workoutType: 'Recovery Run', schedule: { localDate: '2099-10-27', timezone: 'America/Argentina/Buenos_Aires' } });
      const page = await fresh(); const mock = newMock({ skips: { [ID]: skipRecord() }, workouts: [workout(), synced] });
      await openSkip(page, mock);
      await page.fill('#ai-json-input', JSON.stringify(newWorkout()));
      await page.waitForFunction(() => document.getElementById('btn-confirm')?.textContent === 'Publish Next Run');
      await page.click('#btn-confirm');
      await page.waitForFunction(() => /Public Next Run published/.test(document.getElementById('save-banner')?.textContent || ''));
      assert.deepEqual(writes(mock).filter((c) => !/skip-preview/.test(c)), [`POST /api/workouts/${NEW_ID}/publish-next-run`]);
    }

    // Recovery summary component: variants, merging rules, compact times, no clipping at any width.
    {
      const day = (over: Record<string, unknown> = {}) => ({ dataTimestamp: '2026-11-14T10:27:00Z', sleepStart: '2026-11-14T04:12:00Z', sleepEnd: '2026-11-14T10:53:00Z', sleepStartLocal: '2026-11-14T01:12:00', sleepEndLocal: '2026-11-14T07:53:00', sleepDurationS: 24060, sleepScore: 80, bodyBatteryMorning: 68, hrv: null, ...over });
      const snap = (g: Record<string, unknown> | null | 'off', i: Record<string, unknown> | null, recent: Record<string, unknown> = {}, av: Record<string, unknown> = {}) => ({
        collectedAt: '2026-11-14T13:10:00Z',
        intervals: i === null ? null : { provenance: 'intervals_athlete_wellness', sessionDate: '2026-11-14', fetchedAt: '2026-11-14T13:10:00Z', recent: { daysConsidered: 7, averageSleepDurationS: 25500, averageSleepScore: 78, averageRestingHeartRate: 52, ...recent }, sessionDay: { updatedAt: '2026-11-14T08:14:00Z', sleepDurationS: 24060, sleepScore: 80, restingHeartRate: 51, hrv: null, ...i } },
        garmin: g === 'off' ? null : { provenance: 'garmin_personal_api_wellness', availability: g ? 'fresh' : 'unavailable', fetchedAt: '2026-11-14T12:27:00Z', failureReason: g ? null : 'timeout', sessionDay: g },
        availability: { intervals: i === null ? 'unavailable' : 'available', garmin: g === 'off' ? 'not_enabled' : g ? 'fresh' : 'unavailable', ...av },
      });
      const variants: Record<string, ReturnType<typeof snap>> = {
        // (longNote is added below)
        all: snap(day(), {}),
        identical: snap(day({ sleepDurationS: 24090 }), {}),
        conflict: snap(day({ hrv: 44 }), { sleepDurationS: 25320, sleepScore: 75, hrv: 49 }),
        noGarmin: snap('off', {}),
        garminDown: snap(null, {}),
        noIntervals: snap(day(), null),
        zeros: snap(day({ sleepScore: 0, bodyBatteryMorning: 0 }), { sleepScore: 0, restingHeartRate: 0 }),
        long: snap(day({ sleepStartLocal: '2026-11-13T23:59:00', sleepEndLocal: '2026-11-14T07:53:00' }), {}, {}, { }),
      };
      variants.longNote = snap(null, {});
      (variants.longNote.garmin as { failureReason: string }).failureReason = 'x'.repeat(120);
      for (const [name, width] of [['desktop', 1100], ['mobile', 320]] as const) {
        const page = await fresh({ width, height: 900 }); const mock = newMock();
        await openSkip(page, mock);
        const render = (snapshot: unknown) => page.evaluate((snap) => { (document.getElementById('skip-recovery') as HTMLElement).innerHTML = (window as any).PacerSkipCommon.recoveryHtml(snap); }, snapshot);
        const cards = async () => page.locator('.rec-card').evaluateAll((els) => els.map((el) => ({ m: (el as HTMLElement).dataset.metric, t: ((el as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim() })));
        const get = async (m: string) => (await cards()).find((c) => c.m === m)!.t;
        const layoutOk = async (label: string) => {
          const bad = await page.evaluate(() => {
            const problems: string[] = [];
            if (document.documentElement.scrollWidth > document.documentElement.clientWidth) problems.push('page overflows horizontally');
            const rects: DOMRect[] = [];
            document.querySelectorAll('.rec-card').forEach((el) => {
              const e = el as HTMLElement;
              if (e.scrollWidth > e.clientWidth + 1) problems.push(`card clipped: ${e.dataset.metric}`);
              e.querySelectorAll('*').forEach((c) => { const r = (c as HTMLElement).getBoundingClientRect(); const pr = e.getBoundingClientRect(); if (r.width && (r.right > pr.right + 1 || r.left < pr.left - 1)) problems.push(`child outside card: ${e.dataset.metric}`); });
              rects.push(e.getBoundingClientRect());
            });
            rects.forEach((a, i) => rects.forEach((b, j) => { if (i < j && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) problems.push('cards overlap'); }));
            return problems;
          });
          assert.deepEqual(bad, [], `${name}/${label}: ${bad.join(', ')}`);
        };
        for (const key of Object.keys(variants)) { await render(variants[key]); await layoutOk(key); }

        await render(variants.all);
        assert.equal((await cards()).length, 4);
        assert.match(await get('sleep'), /^Sleep 6 h 41 min 01:12 → 07:53 Garmin and Intervals\.icu agree$/i);
        assert.match(await get('sleep-score'), /^Sleep score 80 7-day avg 78 Garmin and Intervals\.icu agree$/i);
        assert.match(await get('body-battery'), /^Body Battery \(morning\) 68 Garmin$/i);
        assert.match(await get('resting-hr'), /^Resting HR 51 bpm 7-day avg 52 bpm Intervals\.icu$/i);
        const secondary = await text(page, '.rec-secondary');
        assert.match(secondary, /7-day avg sleep 7 h 05 min/); assert.match(secondary, /HRV unavailable/);
        assert.doesNotMatch(await text(page, '.rec'), /\b2406\d\b|\d{4}-\d{2}-\d{2}T/, 'no raw seconds or ISO strings outside the sources section');
        assert.equal(await page.locator('.rec-prov').evaluate((el) => (el as HTMLDetailsElement).open), false);
        await page.click('.rec-prov summary');
        assert.match(await text(page, '.rec-prov'), /garmin_personal_api_wellness/); assert.match(await text(page, '.rec-prov'), /intervals_athlete_wellness/);
        await layoutOk('provenance open');

        await render(variants.identical);
        assert.match(await get('sleep'), /^Sleep 6 h 4[12] min .*agree$/i); // 30 s apart: one value, not a discrepancy
        assert.equal(await page.locator('.rec-flag').count(), 0);

        await render(variants.conflict);
        assert.equal(await page.locator('.rec-flag').count(), 2); // sleep + score
        assert.match(await get('sleep'), /Garmin 6 h 41 min Intervals\.icu 7 h 02 min Sources differ/i);
        assert.match(await get('sleep-score'), /Garmin 80 Intervals\.icu 75 Sources differ/i);
        assert.match(await text(page, '.rec-secondary'), /HRV: Garmin 44, Intervals\.icu 49 \(sources differ\)/);

        await render(variants.noGarmin);
        assert.match(await text(page, '.rec-note'), /Garmin: not enabled\./);
        assert.match(await get('sleep'), /^Sleep 6 h 41 min Intervals\.icu$/i);
        assert.match(await get('body-battery'), /Unavailable/i);
        await render(variants.garminDown);
        assert.match(await text(page, '.rec-note'), /Garmin: unavailable \(timeout\)\./);
        await render(variants.noIntervals);
        assert.match(await text(page, '.rec-note'), /Intervals\.icu: unavailable\./);
        assert.match(await get('resting-hr'), /Unavailable/i);

        await render(variants.zeros); // zero is a value, not "unavailable"
        assert.match(await get('sleep-score'), /^Sleep score 0 /i); assert.match(await get('body-battery'), /^Body Battery \(morning\) 0 /i); assert.match(await get('resting-hr'), /^Resting HR 0 bpm/i);
        await render(variants.long);
        assert.match(await get('sleep'), /23:59 → 07:53 \(next day\)/i);
        await render(variants.longNote);
        assert.match(await text(page, '.rec-note'), /x{100}/); // long text wraps, no overflow
        await layoutOk('longNote');
      }
    }

    // Exported context and brief are unchanged by the presentation.
    {
      const page = await fresh(); const mock = newMock({ skips: { [ID]: skipRecord() } });
      await openSkip(page, mock);
      await page.click('#skip-copy-all');
      await page.waitForFunction(() => /copied/.test(document.getElementById('skip-copy-status')?.textContent || ''));
      const all = await clip(page);
      assert.ok(all.startsWith(BRIEF));
      const ctx = JSON.parse(all.slice(all.indexOf('{\n  "contractVersion"')));
      assert.equal(ctx.recovery.intervals.sessionDay.sleepDurationS, 25200); // raw seconds stay raw in the export
      assert.equal(ctx.recovery.garmin.sessionDay.sleepStartLocal, '2026-11-12T22:10:00');
      assert.equal(ctx.recovery.garmin.sessionDay.sleepScore, 66);
      assert.equal(ctx.recovery.intervals.sessionDay.restingHeartRate, null);
    }

    // Next workout selection is global: it does not depend on the run selected in the editor.
    {
      const other = { sourceSession: { sourceActivityId: 111, sessionDate: '2026-11-12' } };
      const at = (id: string, date: string, title: string, lc: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
        workout({ pacerWorkoutId: id, title, schedule: { localDate: date, timezone: 'America/Argentina/Buenos_Aires' }, ...other, ...extra }, lc);
      const next = async (mock: Mock) => { const page = await fresh(); await open(page, base, mock); return page; };
      const shown = async (page: Page) => `${await text(page, '#coachat-workout-preview')}|${await text(page, '#workout-status-badge')}`;

      // 1. Skipped workout excluded; replacement anchored to another run is the Next workout.
      let page = await next(newMock({ skips: { [ID]: skipRecord() }, workouts: [workout(), at('wk-b', '2099-10-27', 'Replacement run')] }));
      assert.match(await shown(page), /Replacement run.*\|Sent to Intervals/s);
      // 1b. completed_after_skip is excluded too.
      page = await next(newMock({ skips: { [ID]: skipRecord({ conflictActivityId: 9 }) }, workouts: [workout()] }));
      assert.match(await text(page, '#coachat-workout-preview'), /No upcoming workout/);
      // 4. Unapproved proposals for another run are not presented as the Next workout.
      page = await next(newMock({ workouts: [at('wk-p', '2099-10-26', 'Only proposed', { approvalStatus: 'proposed', syncStatus: 'not_requested' })] }));
      assert.match(await text(page, '#coachat-workout-preview'), /No upcoming workout/);
      // Rejected / superseded / past are inactive.
      page = await next(newMock({ workouts: [at('wk-r', '2099-10-26', 'Rejected', { approvalStatus: 'rejected' }), at('wk-s', '2099-10-26', 'Superseded', { approvalStatus: 'superseded' }), at('wk-o', '2020-01-01', 'Old one')] }));
      assert.match(await text(page, '#coachat-workout-preview'), /No upcoming workout/);
      // 5. Several upcoming workouts: earliest date; same date -> newest revision; deterministic.
      page = await next(newMock({ workouts: [at('wk-late', '2099-11-02', 'Later'), at('wk-r1', '2099-10-30', 'Rev one', {}, { proposalRevision: 1 }), at('wk-r2', '2099-10-30', 'Rev two', {}, { proposalRevision: 2 })] }));
      assert.match(await text(page, '#coachat-workout-preview'), /Rev two/);
      // A workout for the selected run that still needs action (Review & Publish) wins over a synced one.
      page = await next(newMock({ workouts: [at('wk-sync', '2099-10-26', 'Already synced'), at('wk-act', '2099-10-28', 'Needs sync', { approvalStatus: 'approved', syncStatus: 'failed', lastSyncError: 'boom' }, { sourceSession: { sourceActivityId: SOURCE_ID, sessionDate: '2026-10-18' } })] }));
      assert.match(await shown(page), /Needs sync.*\|Sync failed/s);

      // 7. Returning from /skip/ after Approve & Sync refreshes the home panel (replacement anchored elsewhere).
      const mock = newMock({ skips: { [ID]: skipRecord() } });
      page = await fresh();
      await openSkip(page, mock);
      await page.fill('#ai-json-input', JSON.stringify(workout({ pacerWorkoutId: NEW_ID, proposalKey: 'n2', title: 'Anchored elsewhere', schedule: { localDate: '2099-10-27', timezone: 'America/Argentina/Buenos_Aires' }, ...other }, { approvalStatus: 'proposed', syncStatus: 'not_requested', approvedAt: null, syncedAt: null, intervalsEventId: null })));
      await page.click('#btn-confirm');
      await page.waitForFunction(() => /^Done\./.test(document.getElementById('save-banner')?.textContent || ''));
      await page.click('.meta-link');
      await page.waitForFunction(() => /Anchored elsewhere/.test(document.getElementById('coachat-workout-preview')?.textContent || ''));
      assert.equal(await text(page, '#workout-status-badge'), 'Sent to Intervals');
      // Back/forward navigation also shows fresh state.
      await page.goBack(); await page.goForward();
      await page.waitForFunction(() => /Anchored elsewhere/.test(document.getElementById('coachat-workout-preview')?.textContent || ''));
    }

    // Home no longer has a publish control; it never publishes on load.
    {
      const synced = workout({ pacerWorkoutId: NEW_ID, proposalKey: 'new', title: 'Easy Aerobic Reset', schedule: { localDate: '2099-10-27', timezone: 'America/Argentina/Buenos_Aires' } });
      const mock = newMock({ skips: { [ID]: skipRecord() }, workouts: [workout(), synced] });
      const page = await fresh(); await open(page, base, mock);
      assert.match(await text(page, '#coachat-workout-preview'), /Easy Aerobic Reset/);
      assert.equal(await page.locator('[data-skip-action="publish"]').count(), 0);
      assert.doesNotMatch(await text(page, '#workout-skip-actions'), /Publish/i);
      assert.deepEqual(writes(mock), [], 'nothing is written or published on load');
    }

    // Reopening an already-skipped workout (draft gone): the synced Next workout can be re-published without repeating anything.
    {
      const synced = workout({ pacerWorkoutId: NEW_ID, proposalKey: 'new', title: 'Easy Aerobic Reset', schedule: { localDate: '2099-10-27', timezone: 'America/Argentina/Buenos_Aires' } });
      const page = await fresh(); const mock = newMock({ skips: { [ID]: skipRecord() }, workouts: [workout(), synced], failPublish: true });
      await openSkip(page, mock);
      await page.waitForFunction(() => document.getElementById('btn-confirm')?.textContent === 'Publish Next Run');
      assert.match(await text(page, '#skip-workout-preview'), /Easy Aerobic Reset/);
      assert.equal(await text(page, '#workout-status-badge'), 'Sent to Intervals');
      assert.deepEqual(writes(mock).filter((c) => !/skip-preview/.test(c)), [], 'nothing happens on load');
      await page.click('#btn-confirm');
      await page.waitForFunction(() => /Publishing failed: Build failed/.test(document.getElementById('error-banner')?.textContent || ''));
      assert.match(await text(page, '#skip-stages'), /Not published: Build failed/);
      mock.failPublish = false;
      await page.click('#btn-confirm');
      await page.waitForFunction(() => /Public Next Run published/.test(document.getElementById('save-banner')?.textContent || ''));
      assert.equal(await text(page, '#btn-confirm'), 'Published'); assert.equal(await page.locator('#btn-confirm').isDisabled(), true);
      assert.deepEqual(writes(mock).filter((c) => !/skip-preview/.test(c)), Array(2).fill(`POST /api/workouts/${NEW_ID}/publish-next-run`), 'only publication, twice (one failed, one retry)');
    }

    // Already skipped, nothing replaced yet: no publish action is offered.
    {
      const page = await fresh(); const mock = newMock({ skips: { [ID]: skipRecord() } });
      await openSkip(page, mock);
      assert.equal(await page.locator('#btn-confirm').isDisabled(), true);
      assert.equal(await text(page, '#btn-confirm'), 'Confirm, Sync & Publish');
    }

    // Mobile: no horizontal overflow on the page.
    {
      const page = await fresh({ width: 360, height: 700 }); const mock = newMock({ skips: { [ID]: skipRecord() } });
      await openSkip(page, mock);
      assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0);
      assert.equal(await page.locator('#btn-confirm').isVisible(), true);
    }

    // Standalone import on the HOME screen still works (existing behaviour).
    {
      const page = await fresh(); const mock = newMock({ workouts: [] });
      await open(page, base, mock);
      await page.fill('#ai-json-input', JSON.stringify(newWorkout()));
      await page.waitForFunction(() => /Standalone future-workout-v1/.test(document.getElementById('ai-import-status')?.textContent || ''));
      assert.equal(await text(page, '#btn-save'), 'Import Workout');
      assert.deepEqual(writes(mock), []);
      await page.click('#btn-save');
      await page.waitForFunction(() => document.getElementById('workout-status-badge')?.textContent === 'Proposed');
    }
    console.log('Skip Workout UI regression checks passed (all API calls mocked).');
  } finally {
    await browser.close();
    server.close();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
