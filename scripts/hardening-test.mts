import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createRequire } from 'node:module';
import { lookup } from 'node:dns/promises';
import nextEnv from '@next/env';
import { TablesDB, Query } from 'node-appwrite';
nextEnv.loadEnvConfig(process.cwd());
const {integrationFixture}=await import('./integration-fixture');
const {getServerAppwrite}=await import('../src/lib/appwrite/server');
const {createCareCircle}=await import('../src/lib/data/create-care-circle');
const {createSchedule}=await import('../src/lib/data/manage-schedule');
const {claimOccurrence}=await import('../src/lib/data/manage-occurrence-claim');
const {completeOccurrence}=await import('../src/lib/data/complete-occurrence');
const {revokeCaregiverForOwner}=await import('../src/lib/data/manage-caregivers');
const {stableRowId}=await import('../src/lib/domain/ids');
const {TABLES}=await import('../src/lib/domain/schema');
const {teams,users}=getServerAppwrite();
const {getSessionServices}=await import('../src/lib/auth/session');
const {activateTeamForSession}=await import('../src/lib/auth/invitation');
const sessions:{userId:string;sessionId:string}[]=[];
console.log('DNS',await lookup(new URL(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!).hostname));
const f=await integrationFixture('schedule');
const {circleId,ownerId,caregiverId,tables,databaseId}=f;
const circle=await tables.getRow({databaseId,tableId:TABLES.circles,rowId:circleId});
const teamId=String(circle.teamId);const team=await teams.get({teamId});
const list=async(tableId:string,field:string,value:string)=>(await tables.listRows({databaseId,tableId,queries:[Query.equal(field,[value]),Query.limit(100)],total:false})).rows;
const context=new AsyncLocalStorage<{gate:()=>Promise<void>;commitGate?:()=>Promise<void>}>();
const cjs=createRequire(import.meta.url)('node-appwrite') as {TablesDB:typeof TablesDB};
const originals=[...new Set([TablesDB.prototype,cjs.TablesDB.prototype])].map(prototype=>({prototype,getRow:prototype.getRow,updateTransaction:prototype.updateTransaction}));
let occurrenceId:string|undefined;
try {
 if(process.env.TEST_BASE_URL) {
  for(const [userId,expected] of [[caregiverId,403],[ownerId,201]] as const) {
   const session=await users.createSession({userId});sessions.push({userId,sessionId:session.$id});
   await getSessionServices(session.secret).account.updatePrefs({prefs:{primaryTeamId:teamId}});
   const response:Response=await fetch(new URL('/api/onboarding',process.env.TEST_BASE_URL),{method:'POST',headers:{'Content-Type':'application/json',Cookie:`onedose_session=${session.secret}`},body:JSON.stringify({circleName:'HTTP onboarding security probe',recipientName:'Synthetic',timezone:'UTC',routineTitle:'Synthetic',localTime:'00:00'}),signal:AbortSignal.timeout(15000)});
   assert.equal(response.status,expected,`Authenticated onboarding returned ${response.status}; expected ${expected}`);
   assert.equal((await teams.get({teamId})).name,team.name);
  }
  console.log('HTTP onboarding: forged caregiver preferences rejected (403); valid owner recovery succeeds (201)');
 }
 let prefs=0;let result:unknown,error:unknown;
 try {result=await createCareCircle({userId:caregiverId,teamId,input:{circleName:'Unauthorized rename probe',recipientName:'Synthetic',timezone:'UTC',routineTitle:'Synthetic',localTime:'00:00'},account:{updatePrefs:async()=>{prefs++}}});}catch(e){error=e;}
 const changed=(await teams.get({teamId})).name!==team.name;
 console.log(JSON.stringify({probe:'non-owner cross-Team conflict recovery',result,error:(error as Error)?.name,renamed:changed,prefs}));
 assert.equal((error as {code:number})?.code,403);assert.equal(changed,false);assert.equal(prefs,0);
 if(changed)await teams.updateName({teamId,name:team.name});
 const unrelatedTeam=`other_${circleId.slice(-16)}`;
 const unrelatedCircle=`other_circle_${circleId.slice(-16)}`;
 await teams.create({teamId:unrelatedTeam,name:'Unrelated synthetic Team',roles:['owner']});
 try {
  await teams.createMembership({teamId:unrelatedTeam,userId:ownerId,roles:['owner']});
  await tables.createRow({databaseId,tableId:TABLES.circles,rowId:unrelatedCircle,data:{name:'Unrelated synthetic circle',teamId:unrelatedTeam,timezone:'UTC',archivedAt:null},permissions:[]});
  let writes=0;
  await assert.rejects(createCareCircle({userId:caregiverId,teamId:unrelatedTeam,input:{circleName:'Must not change',recipientName:'Synthetic',timezone:'UTC',routineTitle:'Synthetic',localTime:'00:00'},account:{updatePrefs:async()=>{writes++}}}), e=>(e as {code:number}).code===403);
  assert.equal(writes,0);assert.equal((await teams.get({teamId:unrelatedTeam})).name,'Unrelated synthetic Team');
  assert.equal((await list(TABLES.circles,'teamId',unrelatedTeam)).length,1);
  console.log('Unrelated Team: no rename, preferences, or circle rows');
 } finally {try{await tables.deleteRow({databaseId,tableId:TABLES.circles,rowId:unrelatedCircle});}catch(e){if((e as {code:number}).code!==404)throw e}finally{await teams.delete({teamId:unrelatedTeam});}}
 let recoveredPrefs=0;
 const recovered=await createCareCircle({userId:ownerId,teamId,input:{circleName:'Do not rename on recovery',recipientName:'Synthetic',timezone:'UTC',routineTitle:'Synthetic',localTime:'00:00'},account:{updatePrefs:async()=>{recoveredPrefs++}}});
 assert.equal(recovered,circleId);assert.equal(recoveredPrefs,1);assert.equal((await teams.get({teamId})).name,team.name);
 for(const pause of ['read','commit']) {
 if(pause==='commit') {
  await teams.createMembership({teamId,userId:caregiverId,roles:['caregiver']});
  await tables.updateRow({databaseId,tableId:TABLES.members,rowId:stableRowId('mem',`${circleId}:${caregiverId}`),data:{status:'active'}});
 }
 const schedule=await createSchedule(circleId,ownerId,{title:'Synthetic revocation probe',localTime:'00:00',frequency:'daily',active:true});
 const occurrence=(await list(TABLES.occurrences,'scheduleId',schedule.$id))[0];occurrenceId=occurrence.$id;
 assert.equal((await claimOccurrence(occurrenceId,caregiverId)).kind,'claimed');
 let open!:()=>void,seen!:()=>void;
 const gate=new Promise<void>(r=>open=r),ready=new Promise<void>(r=>seen=r);
 for(const {prototype,getRow}of originals)prototype.getRow=(async function(this:TablesDB,...args:unknown[]){const row=await Reflect.apply(getRow,this,args);const p=args[0] as {tableId:string;transactionId?:string};if(p.tableId===TABLES.claims&&p.transactionId){await context.getStore()?.gate();}return row;})as typeof prototype.getRow;
 for(const {prototype,updateTransaction}of originals)prototype.updateTransaction=(async function(this:TablesDB,...args:unknown[]){if((args[0] as {commit?:boolean}).commit)await context.getStore()?.commitGate?.();return Reflect.apply(updateTransaction,this,args);})as typeof prototype.updateTransaction;
 const block=async()=>{seen();await gate};
 const pending=context.run({gate:pause==='read'?block:async()=>{},commitGate:pause==='commit'?block:undefined},()=>completeOccurrence({occurrenceId,actorId:caregiverId,idempotencyKey:`revocation-${circleId}-${pause}`,outcome:'completed',occurredAt:new Date().toISOString()})).then(value=>({value,error:undefined}),error=>({value:undefined,error}));
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{await Promise.race([ready,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Missing pause hook')),15000)})]);clearTimeout(timer);
 const membership=(await teams.listMemberships({teamId,queries:[Query.equal('userId',[caregiverId])]})).memberships[0];
 await revokeCaregiverForOwner({ownerId,circleId,membershipId:membership.$id});
 }finally{clearTimeout(timer);open();await pending;}
 const completion=await pending;const final=await tables.getRow({databaseId,tableId:TABLES.occurrences,rowId:occurrenceId});
 const events=await list(TABLES.events,'occurrenceId',occurrenceId),receipts=await list(TABLES.commands,'occurrenceId',occurrenceId);
 console.log(JSON.stringify({probe:`completion paused at ${pause}, then revoked`,kind:completion.value?.kind,error:completion.error?.name,status:final.status,events:events.length,receipts:receipts.length}));
 assert.equal(completion.error?.name,'CompletionForbiddenError');assert.equal(final.status,'due');assert.equal(events.length,0);assert.equal(receipts.length,0);assert.equal((await claimOccurrence(occurrenceId,ownerId)).kind,'already_claimed');
 await tables.updateRow({databaseId,tableId:TABLES.claims,rowId:stableRowId('clm',occurrenceId),data:{expiresAt:new Date(Date.now()-60000).toISOString()}});
 assert.equal((await claimOccurrence(occurrenceId,ownerId)).kind,'claimed');
 assert.equal((await completeOccurrence({occurrenceId,actorId:ownerId,idempotencyKey:`valid-${circleId}-${pause}`,outcome:'completed',occurredAt:new Date().toISOString()})).kind,'accepted');
 for(const tableId of [TABLES.claims,TABLES.events,TABLES.commands])for(const row of await list(tableId,'occurrenceId',occurrenceId))await tables.deleteRow({databaseId,tableId,rowId:row.$id});
 }
 // Reproduce the state left by a DB revocation followed by failed Team removal:
 // a real confirmed Team membership exists, but the app row remains revoked.
 await teams.createMembership({teamId,userId:caregiverId,roles:['caregiver']});
 const staleTeamSession=await users.createSession({userId:caregiverId});
 sessions.push({userId:caregiverId,sessionId:staleTeamSession.$id});
 await assert.rejects(activateTeamForSession(staleTeamSession.secret,teamId),error=>(error as Error).name==='InvitationRecoveryRequiredError');
 assert.equal((await tables.getRow({databaseId,tableId:TABLES.members,rowId:stableRowId('mem',`${circleId}:${caregiverId}`)})).status,'revoked');
 console.log('Confirmed Team membership cannot reactivate a revoked app membership');
 console.log('Hardening regressions passed');
}finally{
 for(const {prototype,getRow,updateTransaction}of originals){prototype.getRow=getRow;prototype.updateTransaction=updateTransaction;}
 if(occurrenceId)for(const tableId of [TABLES.claims,TABLES.events,TABLES.commands])for(const row of await list(tableId,'occurrenceId',occurrenceId))await tables.deleteRow({databaseId,tableId,rowId:row.$id});
 try {
  for(const session of sessions)await users.deleteSession(session);
 }finally{await f.cleanup();}
}
