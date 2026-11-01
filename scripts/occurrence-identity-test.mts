import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import nextEnv from '@next/env';
import { Query } from 'node-appwrite';
nextEnv.loadEnvConfig(process.cwd());
const {integrationFixture}=await import('./integration-fixture');
const {ensureTodayOccurrences}=await import('../src/lib/data/ensure-occurrences');
const {createSchedule,updateSchedule}=await import('../src/lib/data/manage-schedule');
const {materializeCircle}=await import('../functions/reminders/src/engine.js');
const {occurrenceRowId,occurrenceDateKey}=await import('../functions/reminders/src/occurrence-identity.js');
const {stableRowId}=await import('../src/lib/domain/ids');
const {claimOccurrence}=await import('../src/lib/data/manage-occurrence-claim');
const {completeOccurrence}=await import('../src/lib/data/complete-occurrence');
const {TABLES}=await import('../src/lib/domain/schema');
const f=await integrationFixture('schedule');
const {circleId,databaseId,tables,ownerId}=f;
const circle=await tables.getRow({databaseId,tableId:TABLES.circles,rowId:circleId});
const now=new Date();const day=occurrenceDateKey(now,'Asia/Dubai');
const list=async(scheduleId:string)=>(await tables.listRows({databaseId,tableId:TABLES.occurrences,queries:[Query.equal('scheduleId',[scheduleId]),Query.limit(100)],total:false})).rows;
const ownedIds=new Set<string>();
const related=async(tableId:string,id:string)=>(await tables.listRows({databaseId,tableId,queries:[Query.equal('occurrenceId',[id]),Query.limit(100)],total:false})).rows;
const input={title:'Synthetic occurrence identity',localTime:'00:00',frequency:'daily' as const,active:true};
try{
 for(const mode of ['canonical','legacy-worker','legacy-onboarding']){
  const schedule=await createSchedule(circleId,ownerId,input);
  let row=(await list(schedule.$id))[0];ownedIds.add(row.$id);
  assert.equal(row.$id,occurrenceRowId(schedule.$id,day));
  assert.equal(row.$id,stableRowId('occ',`${schedule.$id}:${day}`));
  if(mode!=='canonical'){
   await tables.deleteRow({databaseId,tableId:TABLES.occurrences,rowId:row.$id});
   const legacy=mode==='legacy-worker'?`occ_${createHash('sha256').update(`${schedule.$id}:${day}`).digest('hex').slice(0,32)}`:`old_${schedule.$id}`;
   const data=Object.fromEntries(Object.entries(row).filter(([key])=>!key.startsWith('$')));
   ownedIds.add(legacy);
   row=await tables.createRow({databaseId,tableId:TABLES.occurrences,rowId:legacy,data,permissions:row.$permissions});
  }
  const calls=await Promise.allSettled(Array.from({length:25},(_,i)=>i%2?materializeCircle(tables,databaseId,circle,now):ensureTodayOccurrences(circleId,now)));
  for(const result of calls)if(result.status==='rejected')throw result.reason;
  assert.equal((await list(schedule.$id)).length,1);
  for(let round=0;round<3;round++){
   const results=await Promise.allSettled([updateSchedule(circleId,schedule.$id,ownerId,{...input,localTime:`00:0${round+1}`}),materializeCircle(tables,databaseId,circle,now),ensureTodayOccurrences(circleId,now)]);
   for(const result of results)if(result.status==='rejected')throw result.reason;
   const after=await list(schedule.$id);assert.equal(after.length,1);assert.equal(after[0].$id,row.$id);assert.equal(after[0].status,'due');
  }
  // Completed history keeps its original identity and cannot be regenerated.
  assert.equal((await claimOccurrence(row.$id,ownerId)).kind,'claimed');
  const completionInput={occurrenceId:row.$id,actorId:ownerId,idempotencyKey:`identity-${circleId}-${mode}`,outcome:'completed',occurredAt:now.toISOString()};
  assert.equal((await completeOccurrence(completionInput)).kind,'accepted');
  const beforeEvents=await related(TABLES.events,row.$id),beforeReceipts=await related(TABLES.commands,row.$id);
  assert.equal(beforeEvents.length,1);assert.equal(beforeReceipts.length,1);
  await updateSchedule(circleId,schedule.$id,ownerId,{...input,localTime:'00:04'});
  await materializeCircle(tables,databaseId,circle,now);await ensureTodayOccurrences(circleId,now);
  const history=await list(schedule.$id);assert.equal(history.length,1);assert.equal(history[0].$id,row.$id);assert.equal(history[0].status,'completed');
  assert.deepEqual(await related(TABLES.events,row.$id),beforeEvents);assert.deepEqual(await related(TABLES.commands,row.$id),beforeReceipts);
  assert.equal((await completeOccurrence(completionInput)).kind,'replayed');
  console.log(JSON.stringify({mode,concurrentGenerators:25,rescheduleRounds:3,finalRows:history.length,identityPreserved:true}));
 }
 console.log('Shared app/worker occurrence identity passed');
}finally{try{for(const id of ownedIds)for(const tableId of [TABLES.claims,TABLES.events,TABLES.commands])for(const row of await related(tableId,id))await tables.deleteRow({databaseId,tableId,rowId:row.$id});}finally{await f.cleanup();}}
