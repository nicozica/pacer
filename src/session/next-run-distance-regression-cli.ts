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
      manual: { sessionType: 'Long Run', legs: 'Normal', sleepScore: null, restedness: '3 - Normal', extraNotes: '' }, files: { tcxFilename: '', tcxAttached: false, briefFilename: '' },
      ai: { signalTitle: 'Signal', signalParagraphs: ['Paragraph.'], carryForward: 'Keep it easy.', nextRunTitle: 'Conversational Long Run', nextRunSummary: 'Historical editorial guidance must not replace the current plan.', nextRunDurationMin: 80, nextRunDurationMax: 80, nextRunDistanceKm: null, nextRunPaceMinSecPerKm: null, nextRunPaceMaxSecPerKm: null, nextRunWorkout: { title: 'Conversational Long Run', type: 'Long Run', blocks: ['Historical text.'] }, weekTitle: 'Week', weekSummary: 'Summary', modelName: null, promptVersion: null, generatedAt: null }, laps: [],
    });
    store.markSessionPublished(saved.core.id, '2026-10-19T00:00:00.000Z');
    const proposal = (proposalKey: string, localDate: string, title: string) => importFutureWorkoutProposal({
      contractVersion: 'future-workout-v1', proposalKey, proposalRevision: 1, proposedAt: '2026-10-19T00:00:00.000Z', updatedAt: '2026-10-19T00:00:00.000Z', sourceSession: { sourceActivityId: 198651687, sessionDate: '2026-10-18' }, schedule: { localDate, timezone: 'America/Argentina/Buenos_Aires' }, workoutType: 'Easy Run', title, coachingNotes: '',
      blocks: [{ kind: 'warmup', duration: { unit: 'time', seconds: 600 }, target: { kind: 'pace', minSecPerKm: 420, maxSecPerKm: 440 } }, { kind: 'work', duration: { unit: 'time', seconds: 1800 }, target: { kind: 'pace', minSecPerKm: 395, maxSecPerKm: 430 } }, { kind: 'cooldown', duration: { unit: 'time', seconds: 300 }, target: { kind: 'pace', minSecPerKm: 420, maxSecPerKm: 440 } }], lifecycle: { approvalStatus: 'proposed', approvedAt: null, approvalNote: null, syncStatus: 'not_requested', syncedAt: null, intervalsEventId: null, lastSyncError: null },
    });
    const skipped = proposal('skipped-long-run', '2099-01-01', 'Conversational Long Run');
    store.importStoredFutureWorkout(skipped); store.approveStoredFutureWorkout(skipped.pacerWorkoutId); store.finishFutureWorkoutSync(skipped.pacerWorkoutId, 'old-event');
    store.createStoredFutureWorkoutSkip({ pacerWorkoutId: skipped.pacerWorkoutId, skippedAt: '2026-11-14T12:00:00.000Z', explanation: 'Private', wellnessSnapshot: { availability: { intervals: 'unavailable', garmin: 'not_enabled' }, intervals: null, garmin: null }, wellnessCollectedAt: '2026-11-14T12:00:00.000Z', wellnessProvenance: {}, planningAnchor: null });
    const replacement = proposal('easy-reset', '2099-01-02', 'Easy Aerobic Reset');
    store.importStoredFutureWorkout(replacement); store.approveStoredFutureWorkout(replacement.pacerWorkoutId); store.finishFutureWorkoutSync(replacement.pacerWorkoutId, 'replacement-event');
    const first = publishSnapshots().nextRun;
    assert.equal(first?.title, 'Easy Aerobic Reset', 'current approved/synced replacement wins over historical session advice and skipped workouts');
    assert.equal(first?.distanceKm, 6.5, 'the current structured workout supplies its own estimated distance');
    assert.doesNotMatch(JSON.stringify(first), /2099|scheduled|Private|skip|wellness/i, 'the public snapshot excludes future schedule and private skip context');
    assert.deepEqual(publishSnapshots().nextRun, first, 'rebuilding snapshots cannot resurrect the skipped workout');
    const future = proposal('controlled-tempo', '2099-01-03', 'Controlled Tempo Blocks');
    store.importStoredFutureWorkout(future); store.approveStoredFutureWorkout(future.pacerWorkoutId); store.finishFutureWorkoutSync(future.pacerWorkoutId, 'future-event');
    const activitiesPath = path.join(tempDir, 'json', 'activities.latest.json');
    fs.mkdirSync(path.dirname(activitiesPath), { recursive: true });
    fs.writeFileSync(activitiesPath, JSON.stringify({ source: 'intervals', activities: [{ id: 77, name: 'Run', displayActivityName: 'Run', rawActivityName: 'Run', pairedEventId: 'replacement-event', distance: 6500, moving_time: 2700, total_elevation_gain: 0, type: 'Run', sport_type: 'Run', start_date: '2099-01-02T09:00:00Z', start_date_local: '2099-01-02T06:00:00' }] }));
    assert.equal(publishSnapshots().nextRun?.title, 'Controlled Tempo Blocks', 'a verified paired completion removes its planned workout from public Next Run eligibility');
    fs.writeFileSync(activitiesPath, JSON.stringify({ source: 'intervals', activities: [{ id: 77, name: 'Easy Aerobic Reset', displayActivityName: 'Easy Aerobic Reset', rawActivityName: 'Easy Aerobic Reset', pairedEventId: null, distance: 6500, moving_time: 2700, total_elevation_gain: 0, type: 'Run', sport_type: 'Run', start_date: '2099-01-02T09:00:00Z', start_date_local: '2099-01-02T06:00:00' }] }));
    assert.equal(publishSnapshots().nextRun?.title, 'Controlled Tempo Blocks', 'a guarded null-pair completion removes its exact-title planned workout without inventing a pairing');
    store.createStoredFutureWorkoutSkip({ pacerWorkoutId: replacement.pacerWorkoutId, skippedAt: '2026-11-15T12:00:00.000Z', explanation: null, wellnessSnapshot: { availability: { intervals: 'unavailable', garmin: 'not_enabled' }, intervals: null, garmin: null }, wellnessCollectedAt: '2026-11-15T12:00:00.000Z', wellnessProvenance: {}, planningAnchor: null });
    store.createStoredFutureWorkoutSkip({ pacerWorkoutId: future.pacerWorkoutId, skippedAt: '2026-11-15T12:00:00.000Z', explanation: null, wellnessSnapshot: { availability: { intervals: 'unavailable', garmin: 'not_enabled' }, intervals: null, garmin: null }, wellnessCollectedAt: '2026-11-15T12:00:00.000Z', wellnessProvenance: {}, planningAnchor: null });
    assert.equal(publishSnapshots().nextRun, null, 'missing eligible current data never falls back to historical next-run advice');
  } finally { fs.rmSync(tempDir, { recursive: true, force: true }); }
  console.log('Current Next Run snapshot regression checks passed.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
