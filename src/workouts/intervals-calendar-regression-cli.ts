import * as assert from 'node:assert/strict';
import { importFutureWorkoutProposal } from './contract';
import { intervalsWorkoutDescription, toIntervalsCalendarEvent, upsertIntervalsWorkout, validateIntervalsCalendarResponse } from './intervals-calendar';

const parsedFixture = require('./fixtures/intervals-structured-run.fixture.json');

async function main(): Promise<void> {
const proposal = importFutureWorkoutProposal({ contractVersion:'future-workout-v1', proposalKey:'calendar-test', proposalRevision:1, proposedAt:'2026-10-18T00:00:00Z', updatedAt:'2026-10-18T00:00:00Z', sourceSession:{sourceActivityId:198651687,sessionDate:'2026-10-18'}, schedule:{localDate:'2026-10-25',timezone:'America/Argentina/Buenos_Aires'}, workoutType:'Interval Session', title:'2 × 1 km', coachingNotes:'', blocks:[{kind:'warmup',label:'Warm up',duration:{unit:'time',seconds:600},target:{kind:'pace',minSecPerKm:420,maxSecPerKm:440}},{kind:'repeat',repetitions:2,label:'Controlled reps',steps:[{kind:'work',label:'Fast',duration:{unit:'distance',meters:1000},target:{kind:'pace',minSecPerKm:250,maxSecPerKm:260}},{kind:'recovery',label:'Jog recover',duration:{unit:'time',seconds:120},target:{kind:'pace',minSecPerKm:330,maxSecPerKm:360}}]},{kind:'cooldown',label:'Cool down',duration:{unit:'time',seconds:600},target:{kind:'unrestricted'}}], lifecycle:{approvalStatus:'proposed',approvedAt:null,approvalNote:null,syncStatus:'not_requested',syncedAt:null,intervalsEventId:null,lastSyncError:null} });
assert.equal(intervalsWorkoutDescription(proposal), parsedFixture.description);
const event=toIntervalsCalendarEvent(proposal); assert.equal(event.start_date_local,'2026-10-25T00:00:00'); assert.equal(event.external_id,proposal.intervalsEventKey);
const parsedResponse = { ...parsedFixture, external_id: event.external_id };
validateIntervalsCalendarResponse(parsedResponse, event);
const [warmup, repeat, cooldown] = parsedResponse.workout_doc.steps;
assert.deepEqual(warmup, { text:'Warm up', intensity:'warmup', duration:600, pace:{start:420,end:440,units:'secs/km'} });
assert.equal(repeat.text, 'Controlled reps 2x'); assert.equal(repeat.reps, 2);
assert.deepEqual(repeat.steps, [{ text:'Fast', intensity:'active', distance:1000, pace:{start:250,end:260,units:'secs/km'} }, { text:'Jog recover', intensity:'recovery', duration:120, pace:{start:330,end:360,units:'secs/km'} }]);
assert.deepEqual(cooldown, { text:'Cool down', intensity:'cooldown', duration:600 });
await assert.rejects(() => upsertIntervalsWorkout(proposal, { upsert: async () => { throw Error('must not call'); }, findByExternalId: async () => null }), /approved/);
const approved={...proposal,lifecycle:{...proposal.lifecycle,approvalStatus:'approved' as const,approvedAt:'2026-10-18T01:00:00Z'}};
let calls=0; const client={upsert:async (input: typeof event)=>{calls++;return {...input,id:123,workout_doc:{steps:[{}]}};},findByExternalId:async()=>null};
const response=await upsertIntervalsWorkout(approved,client); assert.equal(response.id,123); assert.equal(calls,1);
console.log('Intervals calendar conversion regression checks passed.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
