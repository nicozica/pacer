import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { validateSessionAiIdentity } from './identity';
import type { SessionAIInput } from './types';

const editorState = require('../../web/editor-state.js') as {
  selectSourceActivityAfterRefresh(input: {
    selectedSourceActivityId: number | null;
    previousLatestSourceActivityId: number | null;
    currentLatestSourceActivityId: number | null;
  }): number | null;
  assertAiIdentityMatchesSession(ai: SessionAIInput, session: unknown): void;
  buildAiIdentityBriefLines(session: unknown): string[];
  resolveAiIdentityFields(sourceActivityId: unknown, sessionDate: unknown, session: unknown): {
    sourceActivityId: unknown;
    sessionDate: unknown;
  };
};

function matchingAi(): SessionAIInput {
  return {
    sourceActivityId: 189122513,
    sessionDate: '2026-09-22',
    signalTitle: 'Recovery signal',
    signalParagraphs: ['Expected post-race fatigue.'],
    carryForward: 'Keep recovery easy.',
    nextRunTitle: 'Easy recovery',
    nextRunSummary: 'Run gently.',
    nextRunDurationMin: 30,
    nextRunDurationMax: 35,
    nextRunDistanceKm: 4.5,
    nextRunPaceMinSecPerKm: 420,
    nextRunPaceMaxSecPerKm: 480,
    nextRunWorkout: {
      type: 'Recovery Run',
      blocks: ['30-35 min easy'],
    },
    weekTitle: 'Recover',
    weekSummary: 'Let the marathon settle.',
  };
}

async function main(): Promise<void> {
  assert.equal(editorState.selectSourceActivityAfterRefresh({
    selectedSourceActivityId: 187573238,
    previousLatestSourceActivityId: 187573238,
    currentLatestSourceActivityId: 189122513,
  }), 189122513, 'a new latest activity should replace the previously selected latest');

  assert.equal(editorState.selectSourceActivityAfterRefresh({
    selectedSourceActivityId: 186885859,
    previousLatestSourceActivityId: 187573238,
    currentLatestSourceActivityId: 189122513,
  }), 186885859, 'a deliberately selected older activity should survive refresh');

  const ai = matchingAi();
  const resolved = { sourceActivityId: 189122513, sessionDate: '2026-09-22' };
  const editorSession = {
    selectedSourceActivityId: resolved.sourceActivityId,
    source: { sessionDate: resolved.sessionDate },
  };

  assert.throws(
    () => validateSessionAiIdentity({ ...ai, sourceActivityId: 187573238 }, resolved),
    /does not match resolved activity/,
  );
  assert.throws(
    () => validateSessionAiIdentity({ ...ai, sessionDate: '2026-09-17' }, resolved),
    /does not match resolved activity date/,
  );
  assert.throws(
    () => editorState.assertAiIdentityMatchesSession({ ...ai, sourceActivityId: 187573238 }, editorSession),
    /does not match selected activity/,
  );
  assert.throws(
    () => editorState.assertAiIdentityMatchesSession({ ...ai, sessionDate: '2026-09-17' }, editorSession),
    /does not match selected activity date/,
  );

  validateSessionAiIdentity(ai, resolved);
  editorState.assertAiIdentityMatchesSession(ai, editorSession);
  assert.deepEqual(editorState.resolveAiIdentityFields(undefined, undefined, editorSession), resolved,
    'legacy session-ai-v1 imports bind to the selected session');
  assert.deepEqual(editorState.resolveAiIdentityFields(187573238, '2026-09-17', editorSession), {
    sourceActivityId: 187573238,
    sessionDate: '2026-09-17',
  }, 'explicit identity stays available for mismatch validation');
  assert.throws(
    () => editorState.resolveAiIdentityFields(undefined, undefined, null),
    /Select a valid activity/,
  );
  assert.deepEqual(editorState.buildAiIdentityBriefLines(editorSession).slice(1, 3), [
    '  "sourceActivityId": 189122513',
    '  "sessionDate": "2026-09-22"',
  ]);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pacer-editor-identity-'));
  process.env.STORAGE_DIR = tempDir;
  process.env.DATABASE_FILE = path.join(tempDir, 'pacer.sqlite');
  process.env.CMS_EXPORT_DIR = path.join(tempDir, 'cms');

  try {
    const { getStoredSessionBySourceActivityId, initSessionStore, saveStoredSession } = await import('./storage');
    initSessionStore();
    saveStoredSession({
      core: {
        sessionDate: resolved.sessionDate,
        startDateLocal: '2026-09-22T07:00:00',
        title: 'Recovery Run',
        sport: 'Run',
        source: 'regression-test',
        sourceActivityId: resolved.sourceActivityId,
        distanceM: 4770.4,
        movingTimeS: 2171,
        elapsedTimeS: 2171,
        paceSecPerKm: 455,
        hrAvg: 132,
        hrMax: 150,
        elevationM: null,
        weatherTempC: null,
        weatherCondition: null,
        weatherWindKmh: null,
        polyline: null,
        city: 'Buenos Aires',
      },
      manual: {
        sessionType: 'Recovery Run',
        legs: 'Heavy',
        sleepScore: null,
        restedness: '3 - Normal',
        extraNotes: 'Post-marathon recovery.',
      },
      files: {
        tcxFilename: 'pacer-2026-09-22-189122513.tcx',
        tcxAttached: true,
        briefFilename: 'pacer-2026-09-22-189122513-brief.txt',
      },
      ai: {
        ...ai,
        modelName: null,
        promptVersion: null,
        generatedAt: '2026-09-22T12:00:00.000Z',
      },
      laps: [],
    });

    const saved = getStoredSessionBySourceActivityId(resolved.sourceActivityId);
    assert.equal(saved?.core.sessionDate, resolved.sessionDate);
    assert.equal(saved?.files.briefFilename, 'pacer-2026-09-22-189122513-brief.txt');
    assert.equal(saved?.ai.signalTitle, ai.signalTitle);
    assert.deepEqual(saved?.ai.nextRunWorkout, ai.nextRunWorkout);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  console.log('Editor selection and AI identity regression checks passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
