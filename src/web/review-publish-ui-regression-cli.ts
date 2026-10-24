/* Browser regression for the "3. Review & Publish" section. Every /api call is mocked in-page:
 * no Pacer backend, Strava, Intervals.icu, Garmin or deploy is contacted, and no data is written. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium, type Page } from 'playwright';

const WEB = path.resolve(__dirname, '../../web');
const SOURCE_ID = 198651687;
const DATE = '2026-10-18';
const WORKOUT_ID = 'wk-1';
const lifecycle = (over: Record<string, unknown> = {}) => ({
  approvalStatus: 'proposed', approvedAt: null, approvalNote: null, syncStatus: 'not_requested',
  syncedAt: null, intervalsEventId: null, lastSyncError: null, ...over,
});
const workout = (over: Record<string, unknown> = {}, lc: Record<string, unknown> = {}) => ({
  contractVersion: 'future-workout-v1', pacerWorkoutId: WORKOUT_ID, proposalKey: 'k', proposalRevision: 2,
  proposedAt: '2026-10-18T00:00:00Z', updatedAt: '2026-10-18T00:00:00Z',
  sourceSession: { sourceActivityId: SOURCE_ID, sessionDate: DATE },
  schedule: { localDate: '2099-10-25', timezone: 'America/Argentina/Buenos_Aires' },
  workoutType: 'Long Run', title: 'Conversational Long Run + Pickup', coachingNotes: '',
  blocks: [{ kind: 'work', label: 'Easy', duration: { unit: 'time', seconds: 600 }, target: { kind: 'unrestricted' } }],
  lifecycle: lifecycle(lc), intervalsEventKey: 'x', ...over,
});
const sessionAi = { sourceActivityId: SOURCE_ID, sessionDate: DATE, signalTitle: 'Steady', signalParagraphs: ['Good.'], carryForward: 'Keep easy.', nextRunTitle: 'Long run', nextRunSummary: 's', nextRunDurationMin: 60, nextRunDurationMax: 70, nextRunDistanceKm: 10, nextRunPaceMinSecPerKm: 330, nextRunPaceMaxSecPerKm: 360, weekTitle: 'Week', weekSummary: 'w' };
const envelope = (rev = 2) => JSON.stringify({ contractVersion: 'coachat-response-v1', sessionAi, futureWorkout: workout({ proposalRevision: rev }) });

interface Mock {
  publication: { state: string; publishedAt: string | null; attemptedAt: string | null; message: string | null };
  workouts: Array<ReturnType<typeof workout>>;
  failPublish: boolean; failSync: boolean;
  calls: string[];
}

function newMock(initial: Partial<Mock> = {}): Mock {
  return { publication: { state: 'draft', publishedAt: null, attemptedAt: null, message: null }, workouts: [], failPublish: false, failSync: false, calls: [], ...initial };
}

function bootstrap(mock: Mock) {
  return {
    recentRuns: [{ sourceActivityId: SOURCE_ID, sessionDate: DATE, title: 'Run', rawActivityName: null, displayActivityName: null, workoutCode: null, sessionTypeSuggestion: null, distanceKm: 8, movingTimeLabel: '50:00', savedSessionId: 1, savedSessionMatchedBy: 'id', savedSignalTitle: null }],
    latestPublishedAt: null,
    selectedSession: {
      selectedSourceActivityId: SOURCE_ID, publication: mock.publication, savedSessionId: 1,
      source: { sourceActivityId: SOURCE_ID, sessionDate: DATE, title: 'Run', rawActivityName: null, displayActivityName: null, workoutCode: null, sessionTypeSuggestion: null, sport: 'Run', source: 's', distanceKm: 8, movingTimeLabel: '50:00', elapsedTimeLabel: null, paceLabel: null, hrLine: null, elevationLabel: null, weatherLine: null, city: null },
      manual: { sessionType: '', legs: '', sleepScore: null, restedness: '', extraNotes: '' },
      files: { tcxFilename: '', tcxAttached: false, briefFilename: '' },
      ai: { ...sessionAi }, laps: [], lapSource: 'none', intervalsSegments: [], garminDeviceLaps: [], wellness: null, updatedAt: null,
    },
  };
}

async function install(page: Page, mock: Mock) {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const key = `${route.request().method()} ${url.pathname}`;
    mock.calls.push(key);
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (key === 'GET /api/editor/bootstrap') return json(200, bootstrap(mock));
    if (key === 'GET /api/latest') return json(200, { fetchedAt: null, latestActivity: null, latestRun: null, latestRide: null, last7days: { totalTimeMin: 0, count: 0, runCount: 0, totalRunKm: 0, rideCount: 0, totalRideKm: 0 } });
    if (key === 'GET /api/workouts') return json(200, { proposals: mock.workouts.map((w) => ({ workout: w, revisions: [], preview: [] })) });
    if (key === 'POST /api/coachat/validate') return json(200, { futureWorkout: JSON.parse(route.request().postData() || '{}').futureWorkout });
    if (key === 'POST /api/workouts/import') {
      const incoming = JSON.parse(route.request().postData() || '{}');
      const existing = mock.workouts.find((w) => w.pacerWorkoutId === WORKOUT_ID);
      if (!existing) mock.workouts = [workout({ ...incoming })];
      return json(200, { operation: existing ? 'unchanged' : 'created', proposal: { workout: mock.workouts[0] } });
    }
    if (key === 'POST /api/editor/save' || key === 'POST /api/editor/save-and-publish') {
      const publish = key.endsWith('publish');
      let publishStatus = null;
      if (publish) {
        const ok = !mock.failPublish;
        mock.publication = { state: ok ? 'published' : 'failed', publishedAt: '2026-10-24T00:00:00Z', attemptedAt: '2026-10-24T00:00:00Z', message: ok ? 'ok' : 'Build failed' };
        publishStatus = { ok, message: ok ? 'Production verified' : 'Build failed', outputTail: [], logFile: null, publicUrl: 'https://run.nico.ar', expectedSessionPath: '/s/' };
      }
      return json(200, { ok: true, bootstrap: bootstrap(mock), publishArtifacts: null, publishStatus });
    }
    const match = url.pathname.match(/^\/api\/workouts\/([^/]+)\/(approve|sync)$/);
    if (match) {
      const w = mock.workouts[0];
      if (match[2] === 'approve') {
        if (w.lifecycle.approvalStatus === 'proposed') w.lifecycle = lifecycle({ approvalStatus: 'approved', approvedAt: 'now' });
      } else if (w.lifecycle.syncStatus !== 'synced') {
        w.lifecycle = mock.failSync
          ? lifecycle({ approvalStatus: 'approved', approvedAt: 'now', syncStatus: 'failed', lastSyncError: 'Intervals calendar upsert failed (503).' })
          : lifecycle({ approvalStatus: 'approved', approvedAt: 'now', syncStatus: 'synced', syncedAt: 'now', intervalsEventId: '77' });
      }
      return json(200, { proposal: { workout: w } });
    }
    return json(404, { error: `unmocked ${key}` });
  });
}

const count = (mock: Mock, call: string) => mock.calls.filter((entry) => entry === call).length;
const text = async (page: Page, id: string) => ((await page.locator(`#${id}`).textContent()) || "").trim();

async function open(page: Page, base: string, mock: Mock, paste?: string) {
  page.on('pageerror', (error) => console.error('[pageerror]', error.message));
  page.on('console', (m) => { if (m.type() === 'error') console.error('[console]', m.text().slice(0, 200)); });
  await install(page, mock);
  await page.goto(base);
  await page.waitForSelector('#btn-save-publish:not([disabled])', { timeout: 5000 }).catch(async (error) => {
    console.error(await page.evaluate(() => ({ disabled: (document.getElementById('btn-save-publish') as HTMLButtonElement | null)?.disabled, banner: document.getElementById('error-banner')?.textContent, calls: document.getElementById('last-updated')?.textContent })));
    throw error;
  });
  if (paste) {
    await page.fill('#ai-json-input', paste);
    await page.waitForFunction(() => /valid|analysis only/i.test(document.getElementById('ai-import-status')?.textContent || ''));
  }
}

async function main() {
  const server = http.createServer((req, res) => {
    const rel = (req.url || '/').split('?')[0];
    const file = path.join(WEB, rel === '/' ? 'index.html' : rel);
    if (!file.startsWith(WEB) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  }).listen(0);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
  const browser = await chromium.launch();
  const fresh = async (viewport = { width: 1100, height: 900 }) => (await browser.newContext({ viewport })).newPage();

  try {
    // Structure: one merged section, no modal, no fourth section, one primary action.
    {
      const page = await fresh(); const mock = newMock();
      await open(page, base, mock);
      assert.equal(await page.locator('dialog').count(), 0);
      assert.equal(await page.locator('#coachat-workouts').count(), 0);
      assert.match(await text(page, 'coachat-review'), /Review & Publish/);
      assert.equal(await text(page, 'btn-save-publish'), 'Publish');
      assert.equal(await text(page, 'session-status-badge'), 'Draft');
      assert.equal(await page.locator('#btn-retry-sync').isVisible(), false);
    }

    // Publish & Sync success: order, statuses, honest Garmin wording.
    {
      const page = await fresh(); const mock = newMock();
      await open(page, base, mock, envelope());
      assert.equal(await text(page, 'btn-save-publish'), 'Publish & Sync');
      await page.click('#btn-save-publish');
      await page.waitForFunction(() => document.getElementById('save-banner')?.textContent?.includes('Intervals'));
      const order = mock.calls.filter((call) => /import|save-and-publish|approve|sync/.test(call));
      assert.deepEqual(order, ['POST /api/workouts/import', 'POST /api/editor/save-and-publish', `POST /api/workouts/${WORKOUT_ID}/approve`, `POST /api/workouts/${WORKOUT_ID}/sync`]);
      assert.equal(await text(page, 'session-status-badge'), 'Published');
      assert.equal(await text(page, 'workout-status-badge'), 'Sent to Intervals');
      assert.doesNotMatch(await text(page, 'coachat-review'), /Synced to Garmin/i);
      // A second click (repeat/refresh) neither republishes nor duplicates.
      await page.click('#btn-save-publish');
      await page.waitForFunction(() => document.getElementById('save-banner')?.textContent?.includes('already published'), null, { timeout: 5000 }).catch(async (e) => { console.error(await page.evaluate(() => [document.getElementById('save-banner')?.textContent, document.getElementById('error-banner')?.textContent, document.getElementById('coachat-result')?.textContent])); throw e; });
      assert.equal(count(mock, 'POST /api/editor/save-and-publish'), 1);
      assert.equal(mock.workouts.length, 1);
      // Reload: persisted state, no pasted text.
      await page.reload();
      await page.waitForFunction(() => document.getElementById('session-status-badge')?.textContent === 'Published');
      await page.waitForFunction(() => document.getElementById('workout-status-badge')?.textContent === 'Sent to Intervals');
      assert.match(await text(page, 'coachat-workout-preview'), /Conversational Long Run/);
    }

    // Publish-only when there is no workout.
    {
      const page = await fresh(); const mock = newMock();
      await open(page, base, mock, JSON.stringify(sessionAi));
      assert.equal(await text(page, 'btn-save-publish'), 'Publish');
      await page.click('#btn-save-publish');
      await page.waitForFunction(() => document.getElementById('session-status-badge')?.textContent === 'Published');
      assert.equal(mock.calls.some((call) => /workouts\/.+\/(approve|sync)/.test(call)), false);
    }

    // Partial failure: published stays published, Retry Sync only syncs.
    {
      const page = await fresh(); const mock = newMock({ failSync: true });
      await open(page, base, mock, envelope());
      await page.click('#btn-save-publish');
      await page.waitForFunction(() => document.getElementById('workout-status-badge')?.textContent === 'Sync failed');
      assert.equal(await text(page, 'session-status-badge'), 'Published');
      assert.equal(await page.locator('#btn-retry-sync').isVisible(), true);
      mock.failSync = false;
      await page.click('#btn-retry-sync');
      await page.waitForFunction(() => document.getElementById('workout-status-badge')?.textContent === 'Sent to Intervals');
      assert.equal(count(mock, 'POST /api/editor/save-and-publish'), 1, 'retry must not republish');
      assert.equal(count(mock, 'POST /api/editor/save'), 0);
      assert.equal(mock.workouts.length, 1);
      assert.equal(await page.locator('#btn-retry-sync').isVisible(), false);
    }

    // Publish failure stops before approve/sync and is shown (and persisted) as Failed.
    {
      const page = await fresh(); const mock = newMock({ failPublish: true });
      await open(page, base, mock, envelope());
      await page.click('#btn-save-publish');
      await page.waitForFunction(() => document.getElementById('session-status-badge')?.textContent === 'Failed');
      assert.equal(mock.calls.some((call) => /approve|sync/.test(call)), false);
      assert.equal(mock.workouts[0].lifecycle.approvalStatus, 'proposed');
      await page.reload();
      await page.waitForFunction(() => document.getElementById('session-status-badge')?.textContent === 'Failed');
    }

    // Existing stored states are displayed from persistence; superseded is not offered.
    {
      const page = await fresh(); const mock = newMock({ workouts: [workout({}, { approvalStatus: 'superseded' })] });
      await open(page, base, mock);
      await page.waitForFunction(() => document.getElementById('workout-status-badge')?.textContent === 'Superseded');
      assert.equal(await text(page, 'btn-save-publish'), 'Publish');
    }
    {
      const page = await fresh(); const mock = newMock({ workouts: [workout({}, { approvalStatus: 'approved', syncStatus: 'failed', lastSyncError: 'boom' })] });
      await open(page, base, mock);
      await page.waitForFunction(() => document.getElementById('workout-status-badge')?.textContent === 'Sync failed');
      assert.equal(await page.locator('#btn-retry-sync').isVisible(), true);
    }

    // Mobile: no horizontal overflow, actions visible.
    {
      const page = await fresh({ width: 360, height: 700 }); const mock = newMock();
      await open(page, base, mock, envelope());
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 0, `horizontal overflow ${overflow}px`);
      assert.equal(await page.locator('#btn-save-publish').isVisible(), true);
      assert.equal(await page.locator('#btn-save').isVisible(), true);
    }

    console.log('Review & Publish UI regression checks passed (all API calls mocked).');
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
