import * as assert from 'node:assert/strict';
import * as fs from 'node:fs'; import * as os from 'node:os'; import * as path from 'node:path';

const raw = { contractVersion:'future-workout-v1',proposalKey:'safe-sync',proposalRevision:1,proposedAt:'2026-10-18T00:00:00Z',updatedAt:'2026-10-18T00:00:00Z',sourceSession:{sourceActivityId:198651687,sessionDate:'2026-10-18'},schedule:{localDate:'2026-10-25',timezone:'America/Argentina/Buenos_Aires'},workoutType:'Interval Session',title:'Safe sync',coachingNotes:'',blocks:[{kind:'work',duration:{unit:'time',seconds:60},target:{kind:'pace',minSecPerKm:250,maxSecPerKm:260}}],lifecycle:{approvalStatus:'proposed',approvedAt:null,approvalNote:null,syncStatus:'not_requested',syncedAt:null,intervalsEventId:null,lastSyncError:null}};
async function main(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pacer-sync-')); process.env.STORAGE_DIR=dir; process.env.DATABASE_FILE=path.join(dir,'pacer.sqlite'); process.env.CMS_EXPORT_DIR=path.join(dir,'cms');
 const {importFutureWorkoutProposal}=await import('./contract'); const store=await import('../session/storage'); const {syncFutureWorkout}=await import('./sync-service'); const {toIntervalsCalendarEvent}=await import('./intervals-calendar');
 const proposal=importFutureWorkoutProposal(raw); store.importStoredFutureWorkout(proposal);
 let creates=0; const event=toIntervalsCalendarEvent({...proposal,lifecycle:{...proposal.lifecycle,approvalStatus:'approved',approvedAt:'x'}} as any);
 const client={findByExternalId:async()=>null,upsert:async(e:any)=>{creates++;return {...e,id:77,workout_doc:{steps:[{}]}}}};
 await assert.rejects(()=>syncFutureWorkout(proposal.pacerWorkoutId,client),/approved/);
 store.approveStoredFutureWorkout(proposal.pacerWorkoutId);
 const synced=await syncFutureWorkout(proposal.pacerWorkoutId,client); assert.equal(synced.workout.lifecycle.intervalsEventId,'77'); assert.equal(creates,1);
 const again=await syncFutureWorkout(proposal.pacerWorkoutId,client); assert.equal(again.workout.lifecycle.syncStatus,'synced'); assert.equal(creates,1);
 // A lost response leaves syncing; on restart/retry reconciliation finds the deterministic external id without upsert.
 const Database=require('better-sqlite3'); const db=new Database(process.env.DATABASE_FILE); db.prepare("UPDATE future_workouts SET sync_status='syncing', sync_attempted_at='2000-01-01T00:00:00.000Z', intervals_event_id=NULL WHERE pacer_workout_id=?").run(proposal.pacerWorkoutId); db.close();
 const reconciled=await syncFutureWorkout(proposal.pacerWorkoutId,{findByExternalId:async()=>({...event,id:88,workout_doc:{steps:[{}]}}),upsert:async()=>{throw Error('duplicate write')}}); assert.equal(reconciled.workout.lifecycle.intervalsEventId,'88');
 const retry=importFutureWorkoutProposal({...raw,proposalKey:'safe-sync-retry',schedule:{...raw.schedule,localDate:'2026-10-26'}}); store.importStoredFutureWorkout(retry); store.approveStoredFutureWorkout(retry.pacerWorkoutId);
 const failed=await syncFutureWorkout(retry.pacerWorkoutId,{findByExternalId:async()=>null,upsert:async()=>{throw Error('timeout')}}); assert.equal(failed.workout.lifecycle.syncStatus,'failed');
 const retried=await syncFutureWorkout(retry.pacerWorkoutId,{findByExternalId:async()=>null,upsert:async(e:any)=>({...e,id:99,workout_doc:{steps:[{}]}})}); assert.equal(retried.workout.lifecycle.intervalsEventId,'99');
 const concurrent=importFutureWorkoutProposal({...raw,proposalKey:'safe-sync-concurrent',schedule:{...raw.schedule,localDate:'2026-10-27'}});store.importStoredFutureWorkout(concurrent);store.approveStoredFutureWorkout(concurrent.pacerWorkoutId); let release!:()=>void;const gate=new Promise<void>(r=>release=r);const first=syncFutureWorkout(concurrent.pacerWorkoutId,{findByExternalId:async()=>{await gate;return null},upsert:async(e:any)=>({...e,id:100,workout_doc:{steps:[{}]}})});await assert.rejects(()=>syncFutureWorkout(concurrent.pacerWorkoutId,client),/already in progress/);release();await first;
 console.log('Future workout sync lifecycle regression checks passed.');
}
main().catch(e=>{console.error(e);process.exitCode=1});
