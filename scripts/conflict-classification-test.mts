import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { createRequire } from "node:module";
import nextEnv from "@next/env";
import { Query, TablesDB } from "node-appwrite";
nextEnv.loadEnvConfig(process.cwd());
const {integrationFixture}=await import('./integration-fixture');
const {createSchedule}=await import('../src/lib/data/manage-schedule');
const {claimOccurrence,releaseOccurrenceClaim}=await import('../src/lib/data/manage-occurrence-claim');
const {completeOccurrence}=await import('../src/lib/data/complete-occurrence');
const {updateCaregiverAvailability}=await import('../src/lib/data/manage-alerts');
const {CaregiverMutationConflictError}=await import('../src/lib/data/membership-fence');
const {getServerAppwrite}=await import('../src/lib/appwrite/server');
const {getSessionServices}=await import('../src/lib/auth/session');
const {stableRowId}=await import('../src/lib/domain/ids');
const {TABLES}=await import('../src/lib/domain/schema');
const cjs=createRequire(import.meta.url)('node-appwrite') as {TablesDB:typeof TablesDB};
const originals=[...new Set([TablesDB.prototype,cjs.TablesDB.prototype])].map(p=>({p,update:p.updateTransaction}));
const context=new AsyncLocalStorage<{gate:()=>Promise<void>;commits:number}>();
for(const{p,update}of originals)p.updateTransaction=(async function(this:TablesDB,...args:unknown[]){const t=context.getStore();if((args[0]as{commit?:boolean}).commit&&t)await t.gate();const r=await Reflect.apply(update,this,args);if((args[0]as{commit?:boolean}).commit&&t)t.commits++;return r;})as typeof p.updateTransaction;
const f=await integrationFixture('schedule');const{circleId,caregiverId,ownerId,tables,databaseId}=f;
const {users}=getServerAppwrite();let sessionId:string|undefined;const owned=new Set<string>();
const rows=async(tableId:string,field:string,value:string)=>(await tables.listRows({databaseId,tableId,queries:[Query.equal(field,[value]),Query.limit(100)],total:false})).rows;
const memberId=stableRowId('mem',`${circleId}:${caregiverId}`),authId=stableRowId('auth',memberId),prefId=stableRowId('pref',`${circleId}:${caregiverId}`);
const input={title:'Synthetic caregiver contention',localTime:'00:00',frequency:'daily' as const,active:true};
try{
 for(const mode of ['completion','claim','release','availability']){
  const s=await createSchedule(circleId,ownerId,input),other=await createSchedule(circleId,ownerId,input);
  const o=(await rows(TABLES.occurrences,'scheduleId',s.$id))[0],second=(await rows(TABLES.occurrences,'scheduleId',other.$id))[0];owned.add(o.$id);owned.add(second.$id);
  if(mode==='completion'||mode==='release')assert.equal((await claimOccurrence(o.$id,caregiverId)).kind,'claimed');
  await updateCaregiverAvailability(circleId,caregiverId,{availability:'available'});
  const before=await tables.getRow({databaseId,tableId:TABLES.occurrences,rowId:o.$id});
  const start=(await tables.getRow({databaseId,tableId:TABLES.fences,rowId:authId})).version;
  let resume!:()=>void,seen!:()=>void;const gate=new Promise<void>(r=>resume=r),ready=new Promise<void>(r=>seen=r);const trace={commits:0,gate:async()=>{seen();await gate}};
  const operation=()=>mode==='completion'?completeOccurrence({occurrenceId:o.$id,actorId:caregiverId,idempotencyKey:`counter-${circleId}-${mode}`,outcome:'completed',occurredAt:new Date().toISOString()}):mode==='claim'?claimOccurrence(o.$id,caregiverId):mode==='release'?releaseOccurrenceClaim(o.$id,caregiverId):updateCaregiverAvailability(circleId,caregiverId,{availability:'unavailable'});
  const pending=context.run(trace,operation).then(value=>({value,error:undefined}),error=>({value:undefined,error}));
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{await Promise.race([ready,pending.then(result=>{if(result.error)throw result.error;throw Error('Operation ended before pause')}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Missing commit pause')),15000)})]);clearTimeout(timer);assert.equal((await claimOccurrence(second.$id,caregiverId)).kind,'claimed');}
  finally{clearTimeout(timer);resume();await pending;}
  const result=await pending;assert.ok(result.error instanceof CaregiverMutationConflictError,result.error?.message);assert.equal(trace.commits,0);
  assert.deepEqual(await tables.getRow({databaseId,tableId:TABLES.occurrences,rowId:o.$id}),before);
  assert.equal((await rows(TABLES.events,'occurrenceId',o.$id)).length,0);assert.equal((await rows(TABLES.commands,'occurrenceId',o.$id)).length,0);
  assert.equal((await tables.getRow({databaseId,tableId:TABLES.fences,rowId:authId})).version,start+1);
  assert.equal((await tables.getRow({databaseId,tableId:TABLES.caregiverPreferences,rowId:prefId})).availability,'available');
  console.log(JSON.stringify({mode,loser:result.error.name,staleCommits:trace.commits,partialWrites:0,claimUnchanged:true}));
 }
 if(process.env.TEST_BASE_URL){
  const session=await users.createSession({userId:caregiverId});sessionId=session.$id;
  await getSessionServices(session.secret).account.updatePrefs({prefs:{circleId}});
  const before=Number((await tables.getRow({databaseId,tableId:TABLES.fences,rowId:authId})).version);
  const results=await Promise.allSettled(Array.from({length:12},()=>fetch(new URL('/api/circle/availability',process.env.TEST_BASE_URL),{method:'PATCH',headers:{'Content-Type':'application/json',Cookie:`onedose_session=${session.secret}`},body:JSON.stringify({availability:'unavailable'}),signal:AbortSignal.timeout(60000)}).then(async response=>({status:response.status,body:await response.json()}))));
  for(const result of results)if(result.status==='rejected')throw result.reason;
  const responses=results.flatMap(r=>r.status==='fulfilled'?[r.value]:[]);
  for(const r of responses){assert.ok(r.status===200||r.status===409,JSON.stringify(r));if(r.status===409)assert.equal(r.body.code,'caregiver_conflict');else assert.equal(r.body.availability,'unavailable');}
  const successes=responses.filter(r=>r.status===200).length;assert.ok(successes>0);
  assert.equal(Number((await tables.getRow({databaseId,tableId:TABLES.fences,rowId:authId})).version)-before,successes);
  console.log(JSON.stringify({httpAvailabilityRequests:12,successfulCommits:successes,recoverableConflicts:12-successes,unexpectedResponses:0}));
 }
}finally{
 for(const{p,update}of originals)p.updateTransaction=update;
 try{if(sessionId)await users.deleteSession({userId:caregiverId,sessionId});for(const id of owned)for(const tableId of [TABLES.claims,TABLES.events,TABLES.commands])for(const r of await rows(tableId,'occurrenceId',id))await tables.deleteRow({databaseId,tableId,rowId:r.$id});for(const r of await rows(TABLES.caregiverPreferences,'circleId',circleId))await tables.deleteRow({databaseId,tableId:TABLES.caregiverPreferences,rowId:r.$id});}finally{await f.cleanup();}
}
