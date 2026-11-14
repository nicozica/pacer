import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';
import { buildSummary } from './summary';
import { fetchAndSaveActivities } from '../training/fetch';
import { getEditorBootstrap, publishSnapshots, saveSession } from '../session/service';
import { deployRunSite } from '../session/deploy';
import { SaveSessionInput } from '../session/types';
import { createRace, deleteRace, listRaces, RaceInput, updateRace } from '../races/service';
import { approveFutureWorkout, cancelSkippedWorkoutRemotely, completeSkippedWorkout, getFutureWorkout, getSkipWorkoutDetails, getSkipWorkoutPreview, importFutureWorkout, listFutureWorkouts, markFutureWorkoutSkipped, previewFutureWorkoutSkip, publishFutureWorkoutAsPublicNextRun, synchronizeFutureWorkout } from '../workouts/service';
import { validateUnifiedCoachatImport } from '../coachat/service';

const WEB_DIR = path.resolve(process.cwd(), 'web');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function serveFile(res: http.ServerResponse, filePath: string): void {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const ext = path.extname(filePath);
  const mime = MIME[ext] ?? 'text/plain';
  res.writeHead(200, { 'Content-Type': mime });
  fs.createReadStream(filePath).pipe(res);
}

function sendText(res: http.ServerResponse, status: number, text: string): void {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

function readJsonBody<T>(req: http.IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8').trim();
        resolve((raw ? JSON.parse(raw) : {}) as T);
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

// Translates a known error message into a user-friendly string.
function friendlyError(err: Error): string {
  const msg = err.message ?? '';
  if (msg.includes('INTERVALS_API_KEY')) {
    return 'Intervals.icu API key is missing. Set INTERVALS_API_KEY.';
  }
  if (msg.includes('Intervals.icu API error')) {
    return msg;
  }
  if (msg.includes('TRAINING_SOURCE=')) {
    return msg;
  }
  if (msg.includes('401') || msg.includes('403')) {
    return 'Intervals.icu authentication failed. Check INTERVALS_API_KEY and INTERVALS_ATHLETE_ID.';
  }
  if (msg.includes('429')) {
    return 'Intervals.icu API rate limit reached. Wait a few minutes and try again.';
  }
  if (msg.includes('ENOTFOUND') || msg.includes('fetch failed')) {
    return 'Network error. Check your internet connection and try again.';
  }
  return `Refresh failed: ${msg}`;
}

function summarizeAiInput(ai: SaveSessionInput['ai'] | undefined): Record<string, unknown> {
  if (!ai) {
    return {
      hasContent: false,
      signalParagraphCount: 0,
    };
  }

  const paragraphs = Array.isArray(ai.signalParagraphs) ? ai.signalParagraphs.length : 0;

  return {
    hasContent: Boolean(
      ai.signalTitle ||
      paragraphs > 0 ||
      ai.carryForward ||
      ai.nextRunTitle ||
      ai.nextRunSummary ||
      ai.nextRunWorkout ||
      ai.weekTitle ||
      ai.weekSummary,
    ),
    signalTitle: ai.signalTitle || '',
    signalParagraphCount: paragraphs,
    nextRunTitle: ai.nextRunTitle || '',
    nextRunWorkout: ai.nextRunWorkout?.type || '',
    weekTitle: ai.weekTitle || '',
  };
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const url = requestUrl.pathname;
  const method = req.method ?? 'GET';

  if (url === '/api/healthz' && method === 'GET') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (url === '/api/latest' && method === 'GET') {
    try {
      sendJson(res, 200, buildSummary());
    } catch (err) {
      sendJson(res, 500, { error: 'Could not read activity data. Try running `npm run training:fetch` first.' });
    }
    return;
  }

  if (url === '/api/refresh' && method === 'POST') {
    try {
      await fetchAndSaveActivities();
      sendJson(res, 200, buildSummary());
    } catch (err) {
      sendJson(res, 500, { error: friendlyError(err as Error) });
    }
    return;
  }

  if (url === '/api/refresh-and-publish' && method === 'POST') {
    try {
      await fetchAndSaveActivities();
      const publishArtifacts = publishSnapshots();
      const publishStatus = await deployRunSite();

      sendJson(res, 200, {
        ok: publishStatus.ok,
        summary: buildSummary(),
        publishArtifacts,
        publishStatus,
      });
    } catch (err) {
      sendJson(res, 500, { error: friendlyError(err as Error) });
    }
    return;
  }

  if (url === '/api/races' && method === 'GET') {
    try {
      sendJson(res, 200, { races: listRaces() });
    } catch (err) {
      sendJson(res, 500, { error: (err as Error).message });
    }
    return;
  }

  if (url === '/api/races' && method === 'POST') {
    try {
      const race = createRace(await readJsonBody<RaceInput>(req));
      sendJson(res, 201, { race, races: listRaces() });
    } catch (err) {
      sendJson(res, 400, { error: (err as Error).message });
    }
    return;
  }

  if (url === '/api/races/publish' && method === 'POST') {
    const publishStatus = await deployRunSite();
    sendJson(res, publishStatus.ok ? 200 : 500, { ok: publishStatus.ok, publishStatus });
    return;
  }

  // Private Pacer-admin API. These routes are intentionally separate from
  // session saving/publishing and never contact Intervals.icu or Garmin.
  if (url === '/api/workouts' && method === 'GET') {
    try {
      sendJson(res, 200, { proposals: listFutureWorkouts() });
    } catch (err) {
      sendJson(res, 500, { error: (err as Error).message });
    }
    return;
  }

  if (url === '/api/workouts/import' && method === 'POST') {
    try {
      const result = importFutureWorkout(await readJsonBody<unknown>(req));
      sendJson(res, result.operation === 'created' ? 201 : 200, result);
    } catch (err) {
      const message = (err as Error).message;
      const status = /conflict|older|cannot be overwritten/i.test(message) ? 409 : 400;
      sendJson(res, status, { error: message });
    }
    return;
  }

  if (url === '/api/coachat/validate' && method === 'POST') {
    try { sendJson(res, 200, validateUnifiedCoachatImport(await readJsonBody<unknown>(req))); }
    catch (err) { sendJson(res, 400, { error: (err as Error).message }); }
    return;
  }

  const skipCompletionMatch = url.match(/^\/api\/workouts\/([^/]+)\/skip\/complete$/);
  if (skipCompletionMatch) {
    if (method !== 'POST') { sendJson(res, 405, { error: 'Method not allowed.' }); return; }
    try {
      sendJson(res, 200, await completeSkippedWorkout(decodeURIComponent(skipCompletionMatch[1]), await readJsonBody<import('../workouts/service').CompleteSkippedWorkoutInput>(req)));
    } catch (err) {
      const message = (err as Error).message;
      sendJson(res, /not found/i.test(message) ? 404 : /cannot|only approved|paired|synchroniz/i.test(message) ? 409 : 400, { error: message });
    }
    return;
  }

  const remoteCancellationMatch = url.match(/^\/api\/workouts\/([^/]+)\/skip\/cancel-remote$/);
  if (remoteCancellationMatch) {
    if (method !== 'POST') { sendJson(res, 405, { error: 'Method not allowed.' }); return; }
    try {
      sendJson(res, 200, await cancelSkippedWorkoutRemotely(decodeURIComponent(remoteCancellationMatch[1])));
    } catch (err) {
      const message = (err as Error).message;
      sendJson(res, /not found/i.test(message) ? 404 : /only skipped|completed activity|no stored|does not match/i.test(message) ? 409 : 502, { error: message });
    }
    return;
  }

  const skipWorkoutMatch = url.match(/^\/api\/workouts\/([^/]+)\/(skip|skip-preview)$/);
  if (skipWorkoutMatch) {
    const pacerWorkoutId = decodeURIComponent(skipWorkoutMatch[1]);
    const action = skipWorkoutMatch[2];
    try {
      if (action === 'skip-preview' && method === 'GET') {
        sendJson(res, 200, await getSkipWorkoutPreview(pacerWorkoutId));
        return;
      }
      if (action === 'skip-preview' && method === 'POST') {
        sendJson(res, 200, await previewFutureWorkoutSkip(pacerWorkoutId, await readJsonBody<unknown>(req)));
        return;
      }
      if (action === 'skip' && method === 'GET') {
        sendJson(res, 200, getSkipWorkoutDetails(pacerWorkoutId));
        return;
      }
      if (action === 'skip' && method === 'POST') {
        sendJson(res, 200, await markFutureWorkoutSkipped(pacerWorkoutId, await readJsonBody<unknown>(req)));
        return;
      }
      sendJson(res, 405, { error: 'Method not allowed.' });
    } catch (err) {
      const message = (err as Error).message;
      sendJson(res, /not found/i.test(message) ? 404 : /cannot|only approved|paired|synchroniz/i.test(message) ? 409 : 400, { error: message });
    }
    return;
  }

  const workoutMatch = url.match(/^\/api\/workouts\/([^/]+)(?:\/(approve|sync|publish-next-run))?$/);
  if (workoutMatch) {
    const pacerWorkoutId = decodeURIComponent(workoutMatch[1]);
    const action = workoutMatch[2];
    if (!action && method === 'GET') {
      try {
        const proposal = getFutureWorkout(pacerWorkoutId);
        if (!proposal) {
          sendJson(res, 404, { error: 'Future workout not found.' });
        } else {
          sendJson(res, 200, { proposal });
        }
      } catch (err) {
        sendJson(res, 500, { error: (err as Error).message });
      }
      return;
    }
    if (action === 'approve' && method === 'POST') {
      try {
        sendJson(res, 200, { proposal: approveFutureWorkout(pacerWorkoutId, await readJsonBody<unknown>(req)) });
      } catch (err) {
        const message = (err as Error).message;
        sendJson(res, /not found/i.test(message) ? 404 : 409, { error: message });
      }
      return;
    }
    if (action === 'sync' && method === 'POST') {
      try { sendJson(res, 200, { proposal: await synchronizeFutureWorkout(pacerWorkoutId) }); }
      catch (err) { sendJson(res, 409, { error: (err as Error).message }); }
      return;
    }
    if (action === 'publish-next-run' && method === 'POST') {
      try {
        const result = await publishFutureWorkoutAsPublicNextRun(pacerWorkoutId);
        sendJson(res, result.publishStatus.ok ? 200 : 502, result);
      } catch (err) {
        const message = (err as Error).message;
        sendJson(res, /not found|eligible|current/i.test(message) ? 409 : 500, { error: message });
      }
      return;
    }
  }

  if (url.startsWith('/api/races/') && (method === 'PUT' || method === 'DELETE')) {
    const slug = decodeURIComponent(url.slice('/api/races/'.length));
    try {
      if (!slug) throw new Error('Race slug is required.');
      if (method === 'PUT') {
        const race = updateRace(slug, await readJsonBody<RaceInput>(req));
        sendJson(res, 200, { race, races: listRaces() });
      } else {
        deleteRace(slug);
        sendJson(res, 200, { ok: true, races: listRaces() });
      }
    } catch (err) {
      sendJson(res, 400, { error: (err as Error).message });
    }
    return;
  }

  if (url === '/api/editor/bootstrap' && method === 'GET') {
    try {
      const sourceActivityIdRaw = requestUrl.searchParams.get('sourceActivityId');
      const sourceActivityId = sourceActivityIdRaw ? parseInt(sourceActivityIdRaw, 10) : null;
      sendJson(res, 200, await getEditorBootstrap(Number.isNaN(sourceActivityId ?? NaN) ? null : sourceActivityId));
    } catch (err) {
      sendJson(res, 500, { error: (err as Error).message });
    }
    return;
  }

  if ((url === '/api/editor/save' || url === '/api/editor/save-and-publish') && method === 'POST') {
    try {
      const publish = url === '/api/editor/save-and-publish';
      const payload = await readJsonBody<SaveSessionInput>(req);
      console.info('[Pacer API] save request received', {
        mode: publish ? 'save-and-publish' : 'save',
        sourceActivityId: payload.sourceActivityId,
        ai: summarizeAiInput(payload.ai),
      });
      const result = await saveSession(payload, {
        publish,
      });
      console.info('[Pacer API] save request succeeded', {
        mode: publish ? 'save-and-publish' : 'save',
        sourceActivityId: payload.sourceActivityId,
        savedSessionId: result.session.core.id,
        publishedAt: result.session.core.publishedAt,
        publishStatus: result.publishStatus
          ? {
            ok: result.publishStatus.ok,
            message: result.publishStatus.message,
            exitCode: result.publishStatus.exitCode,
            signal: result.publishStatus.signal,
            logFile: result.publishStatus.logFile,
            deployTarget: result.publishStatus.deployTarget,
            verifyOk: result.publishStatus.verifyOk,
            originVerified: result.publishStatus.originVerified,
            publicVerified: result.publishStatus.publicVerified,
            originInconclusive: result.publishStatus.originInconclusive,
            expectedSessionPath: result.publishStatus.expectedSessionPath,
            publicUrl: result.publishStatus.publicUrl,
          }
          : null,
      });
      sendJson(res, 200, {
        ok: true,
        bootstrap: result.bootstrap,
        publishArtifacts: result.publishArtifacts,
        publishStatus: result.publishStatus,
      });
    } catch (err) {
      console.error('[Pacer API] save request failed', err);
      sendJson(res, 400, { error: (err as Error).message });
    }
    return;
  }

  // Static file serving — resolve against WEB_DIR, prevent path traversal
  const rel = url === '/' ? 'index.html' : url.replace(/^\//, '');
  const requestedPath = path.resolve(WEB_DIR, rel);
  if (!requestedPath.startsWith(WEB_DIR)) {
    sendText(res, 403, 'Forbidden');
    return;
  }
  const filePath = fs.existsSync(requestedPath) && fs.statSync(requestedPath).isDirectory()
    ? path.join(requestedPath, 'index.html')
    : requestedPath;
  serveFile(res, filePath);
});

const { webHost, webPort } = config;
server.listen(webPort, webHost, () => {
  console.log(`\nPacer running at http://${webHost}:${webPort}\n`);
});
