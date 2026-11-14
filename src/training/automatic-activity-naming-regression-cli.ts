import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { SourceActivity } from '../session/source';
import type { StoredPlannedWorkoutForActivityRename } from './intervals-activity-rename';

async function main(): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pacer-auto-activity-naming-'));
  process.env.STORAGE_DIR = tempDir; process.env.DATABASE_FILE = path.join(tempDir, 'pacer.sqlite');
  const { importFutureWorkoutProposal } = await import('../workouts/contract');
  const store = await import('../session/storage');
  const { processAutomaticActivityNaming, AUTOMATIC_ACTIVITY_NAMING_NOT_BEFORE, NULL_PAIR_FALLBACK_NOT_BEFORE } = await import('./automatic-activity-naming');
  const { planCompletedActivityRename, planNullPairedEventActivityRename } = await import('./intervals-activity-rename');
  store.initSessionStore();
  const raw = { contractVersion:'future-workout-v1', proposalKey:'automatic-naming', proposalRevision:1, proposedAt:'2026-10-22T00:00:00Z', updatedAt:'2026-10-22T00:00:00Z',sourceSession:{sourceActivityId:1,sessionDate:'2026-10-22'},schedule:{localDate:'2026-10-26',timezone:'America/Argentina/Buenos_Aires'},workoutType:'Easy Run',title:'Progressive Easy + Strides',coachingNotes:'',blocks:[{kind:'work',duration:{unit:'time',seconds:5400},target:{kind:'unrestricted'}}],lifecycle:{approvalStatus:'proposed',approvedAt:null,approvalNote:null,syncStatus:'not_requested',syncedAt:null,intervalsEventId:null,lastSyncError:null} };
  const proposal = importFutureWorkoutProposal(raw); store.importStoredFutureWorkout(proposal); store.approveStoredFutureWorkout(proposal.pacerWorkoutId); store.finishFutureWorkoutSync(proposal.pacerWorkoutId, '146600000');
  const workouts = store.listStoredFutureWorkouts();
  const planned = workouts[0].workout;
  const source = (id: number, type = 'Run', date = '2026-10-26', extras: Partial<SourceActivity> = {}): SourceActivity => ({ id, sourceActivityId:id, source:'intervals', name:'Run', distance:10000, moving_time:5400, total_elevation_gain:0, type, sport_type:type, start_date:date+'T06:00:00Z', start_date_local:date+'T03:00:00', average_speed:2.5, ...extras });
  let puts = 0;
  const titles = new Map<number,string>();
  const snapshots = new Map<number, Record<string, unknown>>();
  const snapshot = (id:number) => ({ id:`i${id}`,name:titles.get(id) ?? 'Run',type:'Run',start_date_local:'2026-10-26T03:00:00',paired_event_id:146600000,strava_id:'123',moving_time:5400,...snapshots.get(id) });
  const client = { get:async(id:number)=>snapshot(id), put:async(id:number,body:{name:string})=>{puts++;titles.set(id,body.name);return snapshot(id);} };
  const run = async (activities: SourceActivity[], availableWorkouts: StoredPlannedWorkoutForActivityRename[] = workouts) => processAutomaticActivityNaming(activities, availableWorkouts, client, new Set());

  // Existing confirmed paired-event route, including the October 24-style generated title.
  let result = await run([source(10)]);
  assert.equal(result[0].outcome, 'renamed'); assert.equal(puts, 1); assert.equal(titles.get(10), planned.title);
  result = await run([source(10)]); assert.equal(result[0].outcome, 'already_correct'); assert.equal(puts, 1);
  titles.set(11, `Buenos Aires City - ${planned.title}`); result = await run([source(11)]);
  assert.equal(result[0].outcome, 'renamed'); assert.equal(puts, 2);
  const october24: StoredPlannedWorkoutForActivityRename = { workout: { ...planned, pacerWorkoutId:'pacer-fw1-925e77eb0537fe9e4929', title:'Easy Shakeout + Strides', schedule:{ ...planned.schedule, localDate:'2026-10-24' }, lifecycle:{ ...planned.lifecycle, intervalsEventId:'147116332' } } };
  const october24Plan = planCompletedActivityRename({ id:'i201081958', name:'Easy Shakeout + Strides', type:'Run', start_date_local:'2026-10-24T06:00:00', paired_event_id:147116332, strava_id:'20712470954', moving_time:2626 }, [october24], { activityId:201081958, plannedWorkoutId:october24.workout.pacerWorkoutId, expectedActivityTitle:'Easy Shakeout + Strides', notBeforeLocalDate:AUTOMATIC_ACTIVITY_NAMING_NOT_BEFORE });
  assert.equal(october24Plan.decision, 'already_correct', 'the successful October 24 paired activity remains unchanged');

  // Strict null-pair fallback: exact city-prefix title + one timed Run + one planned Run.
  titles.set(20, `Buenos Aires City - ${planned.title}`); snapshots.set(20, { paired_event_id:null });
  result = await run([source(20)]); assert.equal(result[0].outcome, 'renamed'); assert.equal(titles.get(20), planned.title); assert.equal(puts, 3);
  result = await run([source(20)]); assert.equal(result[0].outcome, 'already_correct'); assert.equal(puts, 3, 'repeated refresh is idempotent');

  // Ambiguous evidence and never-automatic title classes all skip without a PUT.
  titles.set(21, `Buenos Aires City - ${planned.title}`); snapshots.set(21, { paired_event_id:null }); snapshots.set(22, { paired_event_id:null });
  result = await run([source(21), source(22)]); assert.ok(result.every((entry) => entry.outcome === 'skipped'));
  const secondWorkout: StoredPlannedWorkoutForActivityRename = { workout: { ...planned, pacerWorkoutId:'pacer-fw1-second', intervalsEventKey:'pacer:pacer-fw1-second', lifecycle:{ ...planned.lifecycle, intervalsEventId:'146600001' } } };
  titles.set(23, `Buenos Aires City - ${planned.title}`); snapshots.set(23, { paired_event_id:null }); result = await run([source(23)], [...workouts, secondWorkout]); assert.equal(result[0].outcome, 'skipped');
  titles.set(230, `Buenos Aires City - ${planned.title}`); result = await run([source(230)], [{ workout: planned, skipped: true }]); assert.equal(result[0].outcome, 'skipped', 'skipped workouts are excluded from automatic naming');
  titles.set(24, 'Run'); snapshots.set(24, { paired_event_id:null }); result = await run([source(24)]); assert.equal(result[0].outcome, 'skipped');
  titles.set(25, 'Saturday with Nico'); snapshots.set(25, { paired_event_id:null }); result = await run([source(25)]); assert.equal(result[0].outcome, 'skipped');
  titles.set(26, `Buenos Aires City - ${planned.title}`); snapshots.set(26, { paired_event_id:null, strava_id:null }); result = await run([source(26)]); assert.equal(result[0].outcome, 'skipped');
  titles.set(27, `Buenos Aires City - ${planned.title}`); snapshots.set(27, { paired_event_id:null, moving_time:3600 }); result = await run([source(27)]); assert.equal(result[0].outcome, 'skipped');
  titles.set(28, `Buenos Aires City - ${planned.title}`); snapshots.set(28, { paired_event_id:null, start_date_local:'2026-10-24T03:00:00' }); result = await run([source(28)]); assert.equal(result[0].outcome, 'skipped');
  titles.set(29, `Buenos Aires City - ${planned.title}`); snapshots.set(29, { paired_event_id:null }); result = await run([source(29), source(30,'Ride','2026-10-23',{pairedEventId:146600000})]); assert.equal(result[0].outcome, 'skipped');
  titles.set(31, `Buenos Aires City - ${planned.title}`); snapshots.set(31, { paired_event_id:999 }); result = await run([source(31)]); assert.equal(result[0].outcome, 'skipped');
  assert.equal(puts, 3, 'all rejected fallback cases must avoid remote writes');

  // October 25 is permanently excluded from the fallback, even if refreshed later.
  const october25: StoredPlannedWorkoutForActivityRename = { workout: { ...planned, pacerWorkoutId:'pacer-fw1-aab401f14be48a6b4f1d', title:'Conversational Long Run + Pickup', schedule:{ ...planned.schedule, localDate:'2026-10-25' }, lifecycle:{ ...planned.lifecycle, intervalsEventId:'147756505' } } };
  const october25Activity = source(201464258, 'Run', '2026-10-25', { moving_time:5389 });
  const october25Snapshot = { id:'i201464258', name:'Buenos Aires City - Conversational Long Run + Pickup', type:'Run', start_date_local:'2026-10-25T09:02:13', paired_event_id:null, strava_id:'20726080087', moving_time:5389 };
  const october25Plan = planNullPairedEventActivityRename(october25Snapshot, [october25], { activityId:201464258, plannedWorkoutId:october25.workout.pacerWorkoutId, expectedActivityTitle:october25Snapshot.name, notBeforeLocalDate:NULL_PAIR_FALLBACK_NOT_BEFORE }, [october25Activity]);
  assert.equal(october25Plan.decision, 'historical_activity');
  const putsBeforeCutoff = puts;
  titles.set(201464258, october25Snapshot.name); snapshots.set(201464258, { paired_event_id:null, start_date_local:october25Snapshot.start_date_local, strava_id:october25Snapshot.strava_id, moving_time:october25Snapshot.moving_time });
  result = await run([october25Activity], [october25]); assert.equal(result[0].outcome, 'skipped'); assert.equal(puts, putsBeforeCutoff, 'the fallback never backfills October 25');

  // Existing protections remain in force.
  result = await run([source(32,'Ride'), source(33,'Run','2026-10-22')]); assert.equal(result.length, 0);
  let failedPuts = 0; const failing = { get:async(id:number)=>snapshot(id), put:async()=>{failedPuts++;throw new Error('down');} }; const failed = new Set<number>();
  snapshots.set(34, { paired_event_id:146600000 }); result = await processAutomaticActivityNaming([source(34)], workouts, failing, failed); assert.equal(result[0].outcome, 'failed'); result = await processAutomaticActivityNaming([source(34)], workouts, failing, failed); assert.equal(result[0].outcome, 'skipped'); assert.equal(failedPuts,1,'failed PUT is not retried automatically');
  let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; }); const delayed = { get:async(id:number)=>{await gate;return snapshot(id);}, put:client.put };
  const first = processAutomaticActivityNaming([source(35)], workouts, delayed, new Set()); await Promise.resolve(); result = await run([source(35)]); assert.equal(result[0].outcome, 'skipped'); release(); await first;
  assert.ok(fs.existsSync(process.env.DATABASE_FILE!), 'test database was created only under its temporary directory');
  console.log('Automatic activity naming regression checks passed.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
