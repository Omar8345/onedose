import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { createRequire } from "node:module";
import nextEnv from "@next/env";
import { TablesDB, Query } from "node-appwrite";
nextEnv.loadEnvConfig(process.cwd());
const { integrationFixture } = await import("./integration-fixture");
const { createSchedule, createSchedules, updateSchedule } = await import("../src/lib/data/manage-schedule");
const { materializeCircle } = await import("../functions/reminders/src/engine.js");
const { patchSchedule } = await import("../functions/reminders/src/schedule-lifecycle.js");
const { ensureTodayOccurrences } = await import("../src/lib/data/ensure-occurrences");
const { claimOccurrence } = await import("../src/lib/data/manage-occurrence-claim");
const { completeOccurrence } = await import("../src/lib/data/complete-occurrence");
const { TABLES } = await import("../src/lib/domain/schema");
type Trace = { at: string; gate: () => Promise<void>; paused: boolean; commits: number; failure?: Error; parentCreates: number };
const context = new AsyncLocalStorage<Trace>();
const cjs = createRequire(import.meta.url)("node-appwrite") as { TablesDB: typeof TablesDB };
const originals = [...new Set([TablesDB.prototype, cjs.TablesDB.prototype])].map(p => ({ p, get: p.getRow, list: p.listRows, update: p.updateTransaction, create: p.createRow }));
const pause = async (at: string) => { const t = context.getStore(); if (t && t.at === at && !t.paused) { t.paused = true; await t.gate(); } };
for (const {p,get,list,update,create} of originals) {
 p.createRow=(async function(this:TablesDB,...args:unknown[]){const t=context.getStore();const a=args[0]as{tableId:string};if(t?.failure&&a.tableId===TABLES.schedules){t.parentCreates++;if(t.parentCreates===2)throw t.failure;const row=await Reflect.apply(create,this,args);await pause('parent-create');return row;}return Reflect.apply(create,this,args);})as typeof p.createRow;
 p.getRow = (async function(this:TablesDB,...args:unknown[]){const r=await Reflect.apply(get,this,args);const a=args[0] as {tableId:string;transactionId?:string};if(a.transactionId && a.tableId===TABLES.schedules)await pause('schedule-read');if(a.transactionId && a.tableId===TABLES.occurrences)await pause('occurrence-read');return r;}) as typeof p.getRow;
 p.listRows = (async function(this:TablesDB,...args:unknown[]){const r=await Reflect.apply(list,this,args);const a=args[0] as {tableId:string};if(a.tableId===TABLES.schedules)await pause('schedule-list');if(a.tableId===TABLES.occurrences)await pause('occurrence-list');return r;}) as typeof p.listRows;
 p.updateTransaction=(async function(this:TablesDB,...args:unknown[]){if((args[0] as {commit?:boolean}).commit)await pause('commit');const r=await Reflect.apply(update,this,args);if((args[0] as {commit?:boolean}).commit){const t=context.getStore();if(t)t.commits++;}return r;}) as typeof p.updateTransaction;
}
const f=await integrationFixture('schedule');const{tables,databaseId,circleId,ownerId,caregiverId}=f;
const circle=await tables.getRow({databaseId,tableId:TABLES.circles,rowId:circleId});
const input={title:'Synthetic lifecycle coordination',localTime:'00:00',frequency:'daily' as const,active:true};
const owned=new Set<string>();
async function list(tableId:string,field:string,value:string){const r=await tables.listRows({databaseId,tableId,queries:[Query.equal(field,[value]),Query.limit(100)],total:false});assert.ok(r.rows.length<100);return r.rows;}
async function paused<T>(at:string,operation:()=>Promise<T>,interleave:()=>Promise<void>,failure?:Error){let open!:()=>void,seen!:()=>void;const gate=new Promise<void>(r=>open=r),ready=new Promise<void>(r=>seen=r);const trace:Trace={at,paused:false,commits:0,parentCreates:0,failure,gate:async()=>{seen();await gate}};const pending=context.run(trace,operation).then(value=>({value,error:undefined}),error=>({value:undefined,error}));let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([ready,pending.then(result=>{if(result.error)throw result.error;throw Error('Operation ended before pause')}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error(`Missing pause ${at}`)),15000)})]);clearTimeout(timer);await interleave();}finally{clearTimeout(timer);open();await pending;}return {...await pending,commits:trace.commits};}
try {
 for(const kind of ['worker','app'])for(const at of ['schedule-list','schedule-read','commit']){
  const s=await createSchedule(circleId,ownerId,{...input,active:at==='schedule-list'});for(const r of await list(TABLES.occurrences,'scheduleId',s.$id))owned.add(r.$id);
  if(at!=='schedule-list')await patchSchedule(tables,databaseId,s.$id,circleId,{active:true});
  const result=await paused(at,async()=>{if(kind==='worker')await materializeCircle(tables,databaseId,circle,new Date());else await ensureTodayOccurrences(circleId);},async()=>{await updateSchedule(circleId,s.$id,ownerId,{...input,frequency:'once',date:'2099-01-01'});});
  if(result.error)throw result.error;
  const rows=await list(TABLES.occurrences,'scheduleId',s.$id);rows.forEach(r=>owned.add(r.$id));
  assert.equal(rows.length,0,'Stale materializer must not recreate excluded occurrence');
  assert.equal(result.commits,0);
  console.log(JSON.stringify({case:'exclude-today',kind,at,rows:rows.length,commits:result.commits}));
  await updateSchedule(circleId,s.$id,ownerId,input);const recreated=await list(TABLES.occurrences,'scheduleId',s.$id);assert.equal(recreated.length,1);owned.add(recreated[0].$id);
  await updateSchedule(circleId,s.$id,ownerId,{...input,frequency:'once',date:'2099-01-01'});
  await updateSchedule(circleId,s.$id,ownerId,input);
  const again=await list(TABLES.occurrences,'scheduleId',s.$id);assert.equal(again.length,1);assert.equal(again[0].$id,recreated[0].$id);
  await updateSchedule(circleId,s.$id,ownerId,{...input,active:false});
 }
 {
  for(const kind of ['worker','app'])for(const at of ['schedule-read','commit']) {
   const s=await createSchedule(circleId,ownerId,{...input,active:false});
   await patchSchedule(tables,databaseId,s.$id,circleId,{active:true});
   const result=await paused(at,async()=>{if(kind==='worker')await materializeCircle(tables,databaseId,circle,new Date());else await ensureTodayOccurrences(circleId);},async()=>{await updateSchedule(circleId,s.$id,ownerId,{...input,localTime:'00:02'});});
   if(result.error)throw result.error;
   const rows=await list(TABLES.occurrences,'scheduleId',s.$id);assert.equal(rows.length,1);owned.add(rows[0].$id);assert.equal(new Intl.DateTimeFormat('en-GB',{timeZone:String(circle.timezone),hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(rows[0].dueAt)),'00:02');
   assert.equal(result.commits,0);console.log(JSON.stringify({case:'retime-during-create',kind,at,staleCommits:result.commits,rows:rows.length}));
   await updateSchedule(circleId,s.$id,ownerId,{...input,active:false});
  }
  const s=await createSchedule(circleId,ownerId,{...input,active:false});await patchSchedule(tables,databaseId,s.$id,circleId,{active:true});
  const results=await Promise.allSettled(Array.from({length:25},(_,i)=>i%2?materializeCircle(tables,databaseId,circle,new Date()):ensureTodayOccurrences(circleId)));
  for(const result of results)if(result.status==='rejected')throw result.reason;
  const rows=await list(TABLES.occurrences,'scheduleId',s.$id);assert.equal(rows.length,1);owned.add(rows[0].$id);
  console.log(JSON.stringify({case:'simultaneous-empty-day-app-worker',contenders:25,rows:rows.length}));
  await updateSchedule(circleId,s.$id,ownerId,{...input,active:false});
 }
 for(const at of ['occurrence-read','commit']){
  const s=await createSchedule(circleId,ownerId,input);const o=(await list(TABLES.occurrences,'scheduleId',s.$id))[0];owned.add(o.$id);
  assert.equal((await claimOccurrence(o.$id,caregiverId)).kind,'claimed');
  let eventSnapshot:unknown,receiptSnapshot:unknown;
  const result=await paused(at,()=>updateSchedule(circleId,s.$id,ownerId,{...input,localTime:'00:01'}),async()=>{assert.equal((await completeOccurrence({occurrenceId:o.$id,actorId:caregiverId,idempotencyKey:`timing-${circleId}-${at}`,outcome:'completed',occurredAt:new Date().toISOString()})).kind,'accepted');eventSnapshot=await list(TABLES.events,'occurrenceId',o.$id);receiptSnapshot=await list(TABLES.commands,'occurrenceId',o.$id);});
  const after=await tables.getRow({databaseId,tableId:TABLES.occurrences,rowId:o.$id});assert.equal(after.status,'completed');
  {assert.equal(after.dueAt,o.dueAt);if(result.error){assert.equal(result.error.code,400);assert.equal(result.error.type,'attribute_limit_exceeded');assert.equal(result.commits,0);assert.equal((await tables.getRow({databaseId,tableId:TABLES.schedules,rowId:s.$id})).localTime,'00:00');}}
  assert.deepEqual(await list(TABLES.events,'occurrenceId',o.$id),eventSnapshot);assert.deepEqual(await list(TABLES.commands,'occurrenceId',o.$id),receiptSnapshot);
  console.log(JSON.stringify({case:'completion-before-retime',at,changedTiming:after.dueAt!==o.dueAt,commits:result.commits,error:result.error?.type}));
 }
 const extraRecipient=`test_extra_${circleId.slice(-16)}`;
 await tables.createRow({databaseId,tableId:TABLES.recipients,rowId:extraRecipient,data:{circleId,displayName:'Synthetic second recipient',timezone:'Asia/Dubai',archivedAt:null},permissions:[]});
 const beforeParents=(await list(TABLES.schedules,'circleId',circleId)).map(r=>r.$id).sort();
 const beforeOccurrences=(await list(TABLES.occurrences,'circleId',circleId)).map(r=>r.$id).sort();
 const injected=new Error('INTENTIONAL: second parent creation fails before commit');
 const failed=await paused('parent-create',()=>createSchedules(circleId,ownerId,{...input,recipientIds:[f.recipientId,extraRecipient]}),async()=>{
  assert.deepEqual((await list(TABLES.schedules,'circleId',circleId)).map(r=>r.$id).sort(),beforeParents);
  await materializeCircle(tables,databaseId,circle,new Date());
 },injected);
 assert.equal(failed.error,injected);assert.equal(failed.commits,0);
 assert.deepEqual((await list(TABLES.schedules,'circleId',circleId)).map(r=>r.$id).sort(),beforeParents);
 assert.deepEqual((await list(TABLES.occurrences,'circleId',circleId)).map(r=>r.$id).sort(),beforeOccurrences);
 console.log('Failed parent batch: no visible partial parents or orphan occurrences');
 console.log('Materialization/lifecycle coordination passed');
} finally {
 for(const {p,get,list,update,create} of originals){p.getRow=get;p.listRows=list;p.updateTransaction=update;p.createRow=create;}
 try{for(const r of await list(TABLES.occurrences,'circleId',circleId))owned.add(r.$id);for(const id of owned)for(const tableId of [TABLES.claims,TABLES.events,TABLES.commands])for(const r of await list(tableId,'occurrenceId',id))await tables.deleteRow({databaseId,tableId,rowId:r.$id});}finally{await f.cleanup();}
}
