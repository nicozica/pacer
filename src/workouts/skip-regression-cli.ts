import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { SourceActivity, SourceWellnessContext } from '../session/source';

function activity(id: number, date: string, pairedEventId: number | null = null): SourceActivity {
  return { id, sourceActivityId: id, source: 'intervals', name: `Run ${id}`, displayActivityName: `Run ${id}`, distance: 5000, moving_time: 1800, total_elevation_gain: 0, type: 'Run', sport_type: 'Run', start_date: `${date}T09:00:00Z`, start_date_local: `${date}T06:00:00`, average_speed: 2.8, pairedEventId };
}

function wellness(garmin: 'fresh' | 'stale' | 'unavailable' | null = 'fresh'): SourceWellnessContext {
  const day = { source: 'intervals' as const, provenance: 'intervals_athlete_wellness' as const, date: '2026-11-14', updatedAt: '2026-11-14T10:00:00Z', sleepDurationS: 24000, sleepScore: 71, sleepQuality: null, restingHeartRate: 50, hrv: 42, weightKg: null, fitnessCtl: 50, fatigueAtl: 60, acuteTrainingLoad: null, chronicTrainingLoad: null, rampRate: null };
  const garminDay = { source: 'garmin_personal_api' as const, date: '2026-11-14', dataTimestamp: '2026-11-14T09:55:00Z', sleepDurationS: 24000, sleepScore: 80, deepSleepS: null, lightSleepS: null, remSleepS: null, awakeSleepS: null, sleepStart: '2026-11-14T01:10:00Z', sleepEnd: '2026-11-14T07:50:00Z', sleepStartLocal: '2026-11-13 22:10', sleepEndLocal: '2026-11-14 04:50', sleepStress: null, restingHeartRate: null, heartRateMin: null, heartRateMax: null, hrv: 42, stressLevel: null, stressRestS: null, stressLowS: null, stressMediumS: null, stressHighS: null, bodyBatteryLatest: null, bodyBatteryMin: null, bodyBatteryMax: null, bodyBatteryMorning: 68, bodyBatteryCharged: null, bodyBatteryDrained: null, bodyBatterySamples: [], weightKg: null, weightMeasuredAt: null };
  return { source: 'intervals', provenance: 'intervals_athlete_wellness', sessionDate: '2026-11-14', fetchedAt: '2026-11-14T10:05:00Z', sessionDay: day, recent: { daysConsidered: 7, daysWithSleep: 7, daysWithRestingHeartRate: 7, averageSleepDurationS: 25000, averageSleepScore: 75, averageRestingHeartRate: 51 }, ...(garmin ? { garmin: { source: 'garmin_personal_api' as const, provenance: 'garmin_personal_api_wellness' as const, availability: garmin, sessionDate: '2026-11-14', timeZone: 'America/Argentina/Buenos_Aires', fetchedAt: garmin === 'unavailable' ? null : '2026-11-14T10:06:00Z', lastSuccessfulFetch: garmin === 'stale' ? '2026-11-13T10:06:00Z' : null, failureReason: garmin === 'unavailable' ? 'service_unavailable' as const : null, keyExpiryStatus: 'ok' as const, days: [], sessionDay: garmin === 'unavailable' ? null : garminDay } } : {}) };
}

async function main(): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pacer-skip-workout-'));
  process.env.STORAGE_DIR = tempDir; process.env.DATABASE_FILE = path.join(tempDir, 'pacer.sqlite');
  const { importFutureWorkoutProposal } = await import('./contract');
  const store = await import('../session/storage');
  const { getSkipWorkoutDetails, getSkipWorkoutPreview, skipWorkout } = await import('./skip-service');
  const { syncFutureWorkout } = await import('./sync-service');
  store.initSessionStore();
  const raw = { contractVersion: 'future-workout-v1', proposalKey: 'skip-regression', proposalRevision: 1, proposedAt: '2026-11-13T00:00:00Z', updatedAt: '2026-11-13T00:00:00Z', sourceSession: { sourceActivityId: 99, sessionDate: '2026-11-10' }, schedule: { localDate: '2026-11-14', timezone: 'America/Argentina/Buenos_Aires' }, workoutType: 'Long Run', title: 'Long Run', coachingNotes: '', blocks: [{ kind: 'work', duration: { unit: 'time', seconds: 4800 }, target: { kind: 'unrestricted' } }], lifecycle: { approvalStatus: 'proposed', approvedAt: null, approvalNote: null, syncStatus: 'not_requested', syncedAt: null, intervalsEventId: null, lastSyncError: null } };
  const proposal = importFutureWorkoutProposal(raw); store.importStoredFutureWorkout(proposal); store.approveStoredFutureWorkout(proposal.pacerWorkoutId); store.finishFutureWorkoutSync(proposal.pacerWorkoutId, '501');
  const writeBundle = (activities: SourceActivity[]) => { const target = path.join(tempDir, 'json'); fs.mkdirSync(target, { recursive: true }); fs.writeFileSync(path.join(target, 'activities.latest.json'), JSON.stringify({ fetched_at: '2026-11-14T10:00:00Z', source: 'intervals-api', count: activities.length, activities })); };
  writeBundle([activity(99, '2026-11-10')]);
  const provider = async () => wellness('fresh');
  const preview = await getSkipWorkoutPreview(proposal.pacerWorkoutId, 'Slept longer than usual', provider);
  assert.equal(preview.eligible, true); assert.equal(preview.recoveryPreview.availability.garmin, 'fresh');
  assert.equal(preview.skip, null); assert.equal(preview.skipIntentStatus, 'intended_skip_not_persisted');
  assert.match(preview.brief ?? '', /intended skip pending confirmation/); assert.match(preview.brief ?? '', /Slept longer than usual/);
  assert.match(preview.brief ?? '', /2026-11-13 22:10 to 2026-11-14 04:50/); assert.match(preview.brief ?? '', /distinct from the recovery fetch time/);
  assert.equal(getSkipWorkoutDetails(proposal.pacerWorkoutId).skip, null, 'preview must not persist a skip');
  const first = await skipWorkout(proposal.pacerWorkoutId, 'Insufficient sleep', provider);
  assert.equal(first.operation, 'created'); assert.equal(first.details.outcomeStatus, 'skipped'); assert.equal(first.details.skip?.explanation, 'Insufficient sleep');
  assert.match(first.details.brief ?? '', /no activity was performed/); assert.match(first.details.brief ?? '', /completed activity 99/);
  assert.equal(first.details.planningAnchor?.sourceActivityId, 99);
  assert.throws(() => store.approveStoredFutureWorkout(proposal.pacerWorkoutId), /Skipped workouts cannot be approved or synchronized/);
  assert.throws(() => store.beginFutureWorkoutSync(proposal.pacerWorkoutId), /Skipped workouts cannot be approved or synchronized/);
  assert.throws(() => store.finishFutureWorkoutSync(proposal.pacerWorkoutId, 'new-event'), /Skipped workouts cannot be approved or synchronized/);
  let remoteCalls = 0;
  await assert.rejects(() => syncFutureWorkout(proposal.pacerWorkoutId, { findByExternalId: async () => { remoteCalls += 1; return null; }, upsert: async () => { remoteCalls += 1; throw new Error('must not run'); } }), /Skipped workouts cannot be approved or synchronized/);
  assert.equal(remoteCalls, 0, 'a skipped workout never reaches the remote sync client');
  const duplicate = await skipWorkout(proposal.pacerWorkoutId, 'Different explanation', provider);
  assert.equal(duplicate.operation, 'unchanged'); assert.equal(duplicate.details.skip?.explanation, 'Insufficient sleep');
  assert.equal((await getSkipWorkoutPreview(proposal.pacerWorkoutId, null, async () => wellness('stale'))).recoveryPreview.availability.garmin, 'stale');
  assert.equal((await getSkipWorkoutPreview(proposal.pacerWorkoutId, null, async () => wellness('unavailable'))).recoveryPreview.availability.garmin, 'unavailable');
  assert.equal((await getSkipWorkoutPreview(proposal.pacerWorkoutId, null, async () => null)).recoveryPreview.availability.intervals, 'unavailable');
  writeBundle([activity(99, '2026-11-10'), activity(100, '2026-11-14', 501)]);
  const conflict = getSkipWorkoutDetails(proposal.pacerWorkoutId);
  assert.equal(conflict.outcomeStatus, 'completed_after_skip'); assert.equal(conflict.completedAfterSkipActivityId, 100);
  assert.equal(conflict.planningAnchor?.sourceActivityId, 99, 'the persisted planning anchor does not drift after later activities');
  await assert.rejects(() => skipWorkout('missing', null, provider), /not found/);
  const unapproved = importFutureWorkoutProposal({ ...raw, proposalKey: 'skip-unapproved', schedule: { ...raw.schedule, localDate: '2026-11-15' } }); store.importStoredFutureWorkout(unapproved);
  await assert.rejects(() => skipWorkout(unapproved.pacerWorkoutId, null, provider), /Only approved/);
  const paired = importFutureWorkoutProposal({ ...raw, proposalKey: 'skip-paired', schedule: { ...raw.schedule, localDate: '2026-11-16' } }); store.importStoredFutureWorkout(paired); store.approveStoredFutureWorkout(paired.pacerWorkoutId); store.finishFutureWorkoutSync(paired.pacerWorkoutId, '777');
  writeBundle([activity(101, '2026-11-16', 777)]);
  await assert.rejects(() => skipWorkout(paired.pacerWorkoutId, null, provider), /paired/);
  console.log('Skip workout regression checks passed.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
