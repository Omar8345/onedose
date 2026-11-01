import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { createRequire } from "node:module";
import nextEnv from "@next/env";
import { Query, TablesDB } from "node-appwrite";
nextEnv.loadEnvConfig(process.cwd());
const {integrationFixture}=await import('./integration-fixture');
const {getServerAppwrite}=await import('../src/lib/appwrite/server');
const {getSessionServices}=await import('../src/lib/auth/session');
const {activateCircleMember,checkConfirmedInvitation}=await import('../src/lib/auth/activate-circle-member');
const {InvitationRecoveryRequiredError}=await import('../src/lib/auth/activation-policy');
const {CaregiverMutationConflictError}=await import('../src/lib/data/membership-fence');
const {revokeCaregiverForOwner}=await import('../src/lib/data/manage-caregivers');
const {stableRowId}=await import('../src/lib/domain/ids');
const {TABLES}=await import('../src/lib/domain/schema');
const f=await integrationFixture('schedule');const{tables,databaseId,circleId,caregiverId,ownerId}=f;
const{users,teams}=getServerAppwrite();const teamId=String((await tables.getRow({databaseId,tableId:TABLES.circles,rowId:circleId})).teamId);
const memberId=stableRowId('mem',`${circleId}:${caregiverId}`),counterId=stableRowId('auth',memberId);
let sessionId:string|undefined;
const context=new AsyncLocalStorage<()=>Promise<void>>();
const cjs=createRequire(import.meta.url)('node-appwrite') as {TablesDB:typeof TablesDB};
const originals=[...new Set([TablesDB.prototype,cjs.TablesDB.prototype])].map(p=>({p,update:p.updateTransaction}));
for(const{p,update}of originals)p.updateTransaction=(async function(this:TablesDB,...args:unknown[]){if((args[0]as{commit?:boolean}).commit)await context.getStore()?.();return Reflect.apply(update,this,args);})as typeof p.updateTransaction;
const version=async()=>Number((await tables.getRow({databaseId,tableId:TABLES.fences,rowId:counterId})).version);
async function revoke(){const membership=(await teams.listMemberships({teamId,queries:[Query.equal('userId',[caregiverId])]})).memberships[0];assert.ok(membership);await revokeCaregiverForOwner({ownerId,circleId,membershipId:membership.$id});}
async function restore(){const tx=await tables.createTransaction({ttl:60});try{await tables.incrementRowColumn({databaseId,tableId:TABLES.fences,rowId:counterId,column:'version',value:1,transactionId:tx.$id});await tables.updateRow({databaseId,tableId:TABLES.members,rowId:memberId,data:{status:'active',role:'caregiver',lastMutationAt:new Date().toISOString()},transactionId:tx.$id});await tables.updateTransaction({transactionId:tx.$id,commit:true});}catch(error){await tables.updateTransaction({transactionId:tx.$id,rollback:true}).catch(()=>undefined);throw error;}}
try{
 await tables.deleteRow({databaseId,tableId:TABLES.members,rowId:memberId});
 const session=await users.createSession({userId:caregiverId});sessionId=session.$id;
 const profile=async(pending:string|undefined)=>{
  assert.ok(process.env.TEST_BASE_URL,'Recovery HTTP regression requires TEST_BASE_URL');
  const response=await fetch(new URL('/api/auth/profile',process.env.TEST_BASE_URL),{method:'POST',headers:{'Content-Type':'application/json',Cookie:`onedose_session=${session.secret}${pending?`; onedose_pending_team=${pending}`:''}`},body:JSON.stringify({name:'Synthetic recovery caregiver'}),signal:AbortSignal.timeout(30000)});
  return{status:response.status,body:await response.json()};
 };
 if(process.env.TEST_BASE_URL){const r=await profile(teamId);assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.body.activated,true);}else await activateCircleMember(circleId,teamId,caregiverId,'caregiver');
 assert.equal(await version(),1);assert.equal((await tables.getRow({databaseId,tableId:TABLES.members,rowId:memberId})).status,'active');
 console.log('Fresh invitation: membership and counter created atomically');
 await revoke();assert.equal(await version(),2);await teams.createMembership({teamId,userId:caregiverId,roles:['caregiver']});
 await assert.rejects(checkConfirmedInvitation(teamId,caregiverId),InvitationRecoveryRequiredError);
 await assert.rejects(activateCircleMember(circleId,teamId,caregiverId,'caregiver'),InvitationRecoveryRequiredError);
 if(process.env.TEST_BASE_URL){const r=await profile(teamId);assert.equal(r.status,403);assert.equal(r.body.code,'recovery_required');assert.notEqual(r.body.ok,true);}
 assert.equal(await version(),2);console.log('Revoked caregiver: new invitation/profile cannot restore or report activation success');
 await restore();assert.equal(await version(),3);
 if(process.env.TEST_BASE_URL){const r=await profile(teamId);assert.equal(r.status,200);assert.equal(r.body.activated,true);const ordinary=await profile(undefined);assert.equal(ordinary.status,200);assert.equal(ordinary.body.activated,false);const missing=await profile(`missing_${circleId.slice(-16)}`);assert.equal(missing.status,403);assert.equal(missing.body.code,'activation_unavailable');assert.notEqual(missing.body.ok,true);}else await activateCircleMember(circleId,teamId,caregiverId,'caregiver');
 assert.equal(await version(),3);console.log('Manual restoration: counter advances; subsequent activation preserves it; absent/unavailable pending invitation handled accurately');
 // A successful revocation must also fence an activation which has already
 // staged creation after physical removal of this test-owned member row.
 await tables.deleteRow({databaseId,tableId:TABLES.members,rowId:memberId});
 let open!:()=>void,seen!:()=>void;const gate=new Promise<void>(r=>open=r),ready=new Promise<void>(r=>seen=r);
 const pending=context.run(async()=>{seen();await gate},()=>activateCircleMember(circleId,teamId,caregiverId,'caregiver')).then(value=>({value,error:undefined}),error=>({value:undefined,error}));let timer:ReturnType<typeof setTimeout>|undefined;
 try{await Promise.race([ready,pending.then(result=>{if(result.error)throw result.error;throw Error('Operation ended before pause')}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Missing activation commit pause')),15000)})]);clearTimeout(timer);await revoke();}finally{clearTimeout(timer);open();await pending;}
 const result=await pending;assert.ok(result.error instanceof CaregiverMutationConflictError,result.error?.message);assert.equal(await version(),4);assert.equal((await tables.getRow({databaseId,tableId:TABLES.members,rowId:memberId})).status,'revoked');
 console.log('Commit-paused activation after removal cannot cross revocation; permanent counter retained');
 const prefs=await getSessionServices(session.secret).account.get();assert.equal(prefs.$id,caregiverId);
}finally{for(const{p,update}of originals)p.updateTransaction=update;try{if(sessionId)await users.deleteSession({userId:caregiverId,sessionId});}finally{await f.cleanup();}}
