import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

async function main(): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pacer-next-run-distance-'));
  process.env.STORAGE_DIR = tempDir;
  process.env.DATABASE_FILE = path.join(tempDir, 'pacer.sqlite');
  process.env.CMS_EXPORT_DIR = path.join(tempDir, 'cms');

  try {
    const store = await import('./storage');
    const { importFutureWorkoutProposal } = await import('../workouts/contract');
    const { publishSnapshots } = await import('./service');
    store.initSessionStore();

    const saved = store.saveStoredSession({
      core: { sessionDate: '2026-10-18', startDateLocal: '2026-10-18T08:00:00', title: 'Long Run', sport: 'Run', source: 'test', sourceActivityId: 198651687, distanceM: 12700, movingTimeS: 4800, elapsedTimeS: 4800, paceSecPerKm: 378, hrAvg: 150, hrMax: 178, elevationM: null, weatherTempC: null, weatherCondition: null, weatherWindKmh: null, polyline: null, city: null },
      manual: { sessionType: 'Long Run', legs: 'Normal', sleepScore: null, restedness: '3 - Normal', extraNotes: '' },
      files: { tcxFilename: '', tcxAttached: false, briefFilename: '' },
      ai: { signalTitle: 'Signal', signalParagraphs: ['Paragraph.'], carryForward: 'Keep it easy.', nextRunTitle: 'Tuesday easy', nextRunSummary: 'Stay relaxed.', nextRunDurationMin: 45, nextRunDurationMax: 45, nextRunDistanceKm: null, nextRunPaceMinSecPerKm: 395, nextRunPaceMaxSecPerKm: 440, nextRunWorkout: { title: 'Easy Run', type: 'Easy Run', blocks: ['Human-readable text is not parsed.'] }, weekTitle: 'Week', weekSummary: 'Summary', modelName: null, promptVersion: null, generatedAt: null },
      laps: [],
    });
    store.markSessionPublished(saved.core.id, '2026-10-19T00:00:00.000Z');

    const proposal = importFutureWorkoutProposal({
      contractVersion: 'future-workout-v1', proposalKey: 'easy-run-test', proposalRevision: 1,
      proposedAt: '2026-10-19T00:00:00.000Z', updatedAt: '2026-10-19T00:00:00.000Z',
      sourceSession: { sourceActivityId: 198651687, sessionDate: '2026-10-18' },
      schedule: { localDate: '2026-10-20', timezone: 'America/Argentina/Buenos_Aires' },
      workoutType: 'Easy Run', title: 'Easy Run', coachingNotes: '',
      blocks: [
        { kind: 'warmup', duration: { unit: 'time', seconds: 600 }, target: { kind: 'pace', minSecPerKm: 420, maxSecPerKm: 440 } },
        { kind: 'work', duration: { unit: 'time', seconds: 1800 }, target: { kind: 'pace', minSecPerKm: 395, maxSecPerKm: 430 } },
        { kind: 'cooldown', duration: { unit: 'time', seconds: 300 }, target: { kind: 'pace', minSecPerKm: 420, maxSecPerKm: 440 } },
      ],
      lifecycle: { approvalStatus: 'proposed', approvedAt: null, approvalNote: null, syncStatus: 'not_requested', syncedAt: null, intervalsEventId: null, lastSyncError: null },
    });
    store.importStoredFutureWorkout(proposal);

    assert.equal(publishSnapshots().nextRun?.distanceKm, 6.5, 'export derives an estimate from structured future-workout blocks rather than human-readable text');

    const Database = require('better-sqlite3');
    const db = new Database(process.env.DATABASE_FILE);
    db.prepare('UPDATE session_ai SET next_run_distance_km=? WHERE session_id=?').run(7.2, saved.core.id);
    db.close();
    assert.equal(publishSnapshots().nextRun?.distanceKm, 7.2, 'an explicit distance remains authoritative');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  console.log('Next-run structured distance export regression checks passed.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
