import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { SourceActivity } from '../session/source';

async function main(): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pacer-auto-activity-naming-'));
  process.env.STORAGE_DIR = tempDir; process.env.DATABASE_FILE = path.join(tempDir, 'pacer.sqlite');
  const { importFutureWorkoutProposal } = await import('../workouts/contract');
  const store = await import('../session/storage');
  const { processAutomaticActivityNaming } = await import('./automatic-activity-naming');
  store.initSessionStore();
  const raw = { contractVersion:'future-workout-v1', proposalKey:'automatic-naming', proposalRevision:1, proposedAt:'2026-10-22T00:00:00Z', updatedAt:'2026-10-22T00:00:00Z', sourceSession:{sourceActivityId:1,sessionDate:'2026-10-22'}, schedule:{localDate:'2026-10-23',timezone:'America/Argentina/Buenos_Aires'}, workoutType:'Easy Run',title:'Progressive Easy + Strides',coachingNotes:'',blocks:[{kind:'work',duration:{unit:'time',seconds:60},target:{kind:'unrestricted'}}],lifecycle:{approvalStatus:'proposed',approvedAt:null,approvalNote:null,syncStatus:'not_requested',syncedAt:null,intervalsEventId:null,lastSyncError:null} };
  const proposal = importFutureWorkoutProposal(raw); store.importStoredFutureWorkout(proposal); store.approveStoredFutureWorkout(proposal.pacerWorkoutId); store.finishFutureWorkoutSync(proposal.pacerWorkoutId, '146600000');
  const workouts = store.listStoredFutureWorkouts();
  const source = (id: number, type = 'Run', date = '2026-10-23'): SourceActivity => ({ id, sourceActivityId:id, source:'intervals', name:'Run', distance:1, moving_time:1, total_elevation_gain:0, type, sport_type:type, start_date:date+'T06:00:00Z', start_date_local:date+'T03:00:00', average_speed:1 });
  let puts = 0; let gets = 0; const titles = new Map<number,string>();
  const snapshot = (id:number, name=titles.get(id) ?? 'Run', extras: Record<string, unknown> = {}) => ({ id:`i${id}`,name,type:'Run',start_date_local:'2026-10-23T03:00:00',paired_event_id:146600000,strava_id:'123',...extras });
  const client = { get:async(id:number)=>{gets++;return snapshot(id);}, put:async(id:number,body:{name:string})=>{puts++;titles.set(id,body.name);return snapshot(id,body.name);} };
  let result = await processAutomaticActivityNaming([source(10)], workouts, client, new Set());
  assert.equal(result[0].outcome, 'renamed'); assert.equal(puts, 1); assert.equal(titles.get(10), 'Progressive Easy + Strides');
  result = await processAutomaticActivityNaming([source(10)], workouts, client, new Set()); assert.equal(result[0].outcome, 'already_correct'); assert.equal(puts, 1);
  titles.set(11, 'Buenos Aires City - Progressive Easy + Strides'); result = await processAutomaticActivityNaming([source(11)], workouts, client, new Set()); assert.equal(result[0].outcome, 'renamed');
  titles.set(12, 'Saturday with Nico'); result = await processAutomaticActivityNaming([source(12)], workouts, client, new Set()); assert.equal(result[0].outcome, 'skipped');
  const noPair = { ...client, get:async(id:number)=>snapshot(id,'Run',{paired_event_id:null}) }; result = await processAutomaticActivityNaming([source(13)], workouts, noPair, new Set()); assert.equal(result[0].outcome, 'skipped');
  const noStrava = { ...client, get:async(id:number)=>snapshot(id,'Run',{strava_id:null}) }; result = await processAutomaticActivityNaming([source(14)], workouts, noStrava, new Set()); assert.equal(result[0].outcome, 'skipped');
  result = await processAutomaticActivityNaming([source(15,'Ride'), source(16,'Run','2026-10-22')], workouts, client, new Set()); assert.equal(result.length, 0);
  const ambiguous = [...workouts, { workout: { ...workouts[0].workout, pacerWorkoutId:'pacer-fw1-duplicate' } }]; result = await processAutomaticActivityNaming([source(17)], ambiguous, client, new Set()); assert.equal(result[0].outcome, 'skipped');
  let failedPuts = 0; const failing = { get:async(id:number)=>snapshot(id), put:async()=>{failedPuts++;throw new Error('down');} }; const failed = new Set<number>(); result = await processAutomaticActivityNaming([source(18)], workouts, failing, failed); assert.equal(result[0].outcome, 'failed'); result = await processAutomaticActivityNaming([source(18)], workouts, failing, failed); assert.equal(result[0].outcome, 'skipped'); assert.equal(failedPuts,1,'failed PUT is not retried automatically');
  let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; }); const delayed = { get:async(id:number)=>{await gate;return snapshot(id);}, put:client.put }; const first = processAutomaticActivityNaming([source(19)], workouts, delayed, new Set()); await Promise.resolve(); result = await processAutomaticActivityNaming([source(19)], workouts, client, new Set()); assert.equal(result[0].outcome, 'skipped'); release(); await first;
  assert.ok(fs.existsSync(process.env.DATABASE_FILE!), 'test database was created only under its temporary directory');
  console.log('Automatic activity naming regression checks passed.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
