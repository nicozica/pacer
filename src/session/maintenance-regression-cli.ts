import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

async function main(): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pacer-maintenance-'));
  process.env.STORAGE_DIR = tempDir;
  process.env.DATABASE_FILE = path.join(tempDir, 'pacer.sqlite');
  process.env.CMS_EXPORT_DIR = path.join(tempDir, 'cms');
  const store = await import('./storage');
  const { importFutureWorkoutProposal } = await import('../workouts/contract');
  const { renameIntervalsEvent } = await import('../workouts/intervals-event-rename');
  store.initSessionStore();

  const raw = { contractVersion:'future-workout-v1', proposalKey:'maintenance-workout', proposalRevision:1, proposedAt:'2026-10-18T00:00:00Z', updatedAt:'2026-10-18T00:00:00Z', sourceSession:{sourceActivityId:198651687,sessionDate:'2026-10-18'}, schedule:{localDate:'2026-10-20',timezone:'America/Argentina/Buenos_Aires'}, workoutType:'Easy Run',title:'Easy Aerobic Run',coachingNotes:'',blocks:[{kind:'warmup',label:'Warm up',duration:{unit:'time',seconds:600},target:{kind:'pace',minSecPerKm:420,maxSecPerKm:440}},{kind:'work',label:'Run',duration:{unit:'time',seconds:1800},target:{kind:'pace',minSecPerKm:395,maxSecPerKm:430}},{kind:'cooldown',label:'Cool down',duration:{unit:'time',seconds:300},target:{kind:'pace',minSecPerKm:420,maxSecPerKm:440}}],lifecycle:{approvalStatus:'proposed',approvedAt:null,approvalNote:null,syncStatus:'not_requested',syncedAt:null,intervalsEventId:null,lastSyncError:null} };
  const proposal = importFutureWorkoutProposal(raw);
  store.importStoredFutureWorkout(proposal); store.approveStoredFutureWorkout(proposal.pacerWorkoutId); store.finishFutureWorkoutSync(proposal.pacerWorkoutId, '145978255');
  const Database = require('better-sqlite3'); const beforeDb = new Database(process.env.DATABASE_FILE, { readonly:true }); const beforeJson = JSON.parse(beforeDb.prepare('SELECT proposal_json FROM future_workouts WHERE pacer_workout_id=?').get(proposal.pacerWorkoutId).proposal_json); beforeDb.close();
  const renameInput = { pacerWorkoutId:proposal.pacerWorkoutId, proposalKey:proposal.proposalKey, expectedTitle:'Easy Aerobic Run', nextTitle:'Easy Run', expectedIntervalsEventId:'145978255' };
  assert.deepEqual(store.renameStoredSyncedFutureWorkout({ ...renameInput, dryRun:true }), { applied:false, oldTitle:'Easy Aerobic Run', newTitle:'Easy Run' });
  assert.equal(store.getStoredFutureWorkout(proposal.pacerWorkoutId)?.workout.title, 'Easy Aerobic Run');
  assert.equal(store.renameStoredSyncedFutureWorkout(renameInput).applied, true);
  const renamed = store.getStoredFutureWorkout(proposal.pacerWorkoutId)!;
  assert.equal(renamed.workout.title, 'Easy Run'); assert.equal(renamed.workout.pacerWorkoutId, proposal.pacerWorkoutId); assert.equal(renamed.workout.proposalRevision, 1); assert.equal(renamed.workout.lifecycle.syncStatus, 'synced'); assert.equal(renamed.workout.lifecycle.intervalsEventId, '145978255'); assert.equal(renamed.revisions.length, 2);
  const afterDb = new Database(process.env.DATABASE_FILE, { readonly:true }); const afterJson = JSON.parse(afterDb.prepare('SELECT proposal_json FROM future_workouts WHERE pacer_workout_id=?').get(proposal.pacerWorkoutId).proposal_json); afterDb.close(); assert.deepEqual({...afterJson,title:beforeJson.title}, beforeJson);
  assert.throws(() => store.renameStoredSyncedFutureWorkout(renameInput), /title or proposal identity/);

  const originalFeedback = { signalTitle:'Strong Finish', signalParagraphs:['First observation.'], carryForward:'Recover tomorrow.' };
  const nextFeedback = { signalTitle:'Controlled finish', signalParagraphs:['Keep the aerobic work controlled.'], carryForward:'Keep Tuesday easy.' };
  const saved = store.saveStoredSession({
    core:{sessionDate:'2026-10-18',startDateLocal:'2026-10-18T08:00:00',title:'Long Run',sport:'Run',source:'intervals',sourceActivityId:198651687,distanceM:12700,movingTimeS:4800,elapsedTimeS:4900,paceSecPerKm:378,hrAvg:150,hrMax:178,elevationM:0,weatherTempC:null,weatherCondition:null,weatherWindKmh:null,polyline:null,city:null},
    manual:{sessionType:'Long Run',legs:'normal',sleepScore:null,restedness:'okay',extraNotes:''}, files:{tcxFilename:'',tcxAttached:false,briefFilename:'brief.txt'},
    ai:{...originalFeedback,nextRunTitle:'Easy Aerobic Run',nextRunSummary:'',nextRunDurationMin:null,nextRunDurationMax:null,nextRunDistanceKm:null,nextRunPaceMinSecPerKm:null,nextRunPaceMaxSecPerKm:null,nextRunWorkout:null,weekTitle:'',weekSummary:'',modelName:null,promptVersion:null,generatedAt:null},
    laps:[1,2,3].map((lapIndex) => ({id:null,lapIndex,distanceM:1000,durationS:360,paceSecPerKm:360,hrAvg:150,lapSource:'intervals' as const})),
  });
  const feedbackInput = { sessionId:saved.core.id, sourceActivityId:198651687, sessionDate:'2026-10-18', expectedLapCount:3, expected:originalFeedback, next:nextFeedback };
  assert.equal(store.updateStoredSessionFeedback({ ...feedbackInput, dryRun:true }).applied, false);
  assert.deepEqual(store.getStoredSessionBySourceActivityId(198651687)?.ai.signalParagraphs, originalFeedback.signalParagraphs);
  assert.equal(store.updateStoredSessionFeedback(feedbackInput).applied, true);
  const updated = store.getStoredSessionBySourceActivityId(198651687)!;
  assert.equal(updated.core.title, 'Long Run'); assert.equal(updated.laps.length, 3); assert.deepEqual(updated.ai.signalParagraphs, nextFeedback.signalParagraphs); assert.equal(updated.ai.nextRunTitle, 'Easy Aerobic Run');
  assert.throws(() => store.updateStoredSessionFeedback({ ...feedbackInput, expected:originalFeedback }), /no longer matches/);
  const nextRunTitleInput = { sessionId:saved.core.id, sourceActivityId:198651687, sessionDate:'2026-10-18', expectedLapCount:3, expectedNextRunTitle:'Easy Aerobic Run', nextRunTitle:'Easy Run' };
  assert.deepEqual(store.updateStoredSessionNextRunTitle({ ...nextRunTitleInput, dryRun:true }), { applied:false, oldTitle:'Easy Aerobic Run', newTitle:'Easy Run' });
  assert.equal(store.updateStoredSessionNextRunTitle(nextRunTitleInput).applied, true);
  assert.equal(store.getStoredSessionBySourceActivityId(198651687)?.ai.nextRunTitle, 'Easy Run');
  assert.throws(() => store.updateStoredSessionNextRunTitle(nextRunTitleInput), /no longer matches/);

  const remote = { id:145978255, external_id:'pacer:pacer-fw1-fixture', start_date_local:'2026-10-20T00:00:00', end_date_local:'2026-10-21T00:00:00', calendar_id:1, category:'WORKOUT', type:'Run', name:'Easy Aerobic Run', description:'- Warm up 10m intensity=warmup', indoor:null, color:null, not_on_fitness_chart:false, show_as_note:false, show_on_ctl_line:false, for_week:false, target:null, carbs_used:null, carbs_per_hour:null, load_target:null, time_target:null, distance_target:null, training_availability:'NORMAL', max_training_time:null, can_train_sports:null, hide_from_athlete:false, tags:null, sub_type:null, attachments:null, workout_doc:{steps:[{text:'Warm up',intensity:'warmup',duration:600}] } };
  let puts = 0; let remoteName = remote.name;
  const client = { get:async()=>({...remote,name:remoteName}), put:async (_id:number, body:Record<string,unknown>)=>{puts++; assert.equal(body.name,'Easy Run'); assert.equal('workout_doc' in body,false); assert.equal(body.description,remote.description); remoteName=String(body.name); return {...remote,name:remoteName};} };
  const remoteInput = {eventId:145978255,externalId:remote.external_id,localDate:'2026-10-20',expectedTitle:'Easy Aerobic Run',nextTitle:'Easy Run'};
  const preview = await renameIntervalsEvent({...remoteInput,dryRun:true}, client); assert.equal(preview.applied,false); assert.equal(puts,0);
  const applied = await renameIntervalsEvent(remoteInput, client); assert.equal(applied.applied,true); assert.equal(puts,1);
  await assert.rejects(() => renameIntervalsEvent({...remoteInput,expectedTitle:'Easy Aerobic Run'}, client), /identity/); assert.equal(puts,1);
  console.log('Scoped maintenance regression checks passed.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
