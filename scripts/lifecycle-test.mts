import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { createRequire } from "node:module";
import nextEnv from "@next/env";
import { Query, TablesDB } from "node-appwrite";

nextEnv.loadEnvConfig(process.cwd());
const [{ integrationFixture }, { claimOccurrence },
  { completeOccurrence }, { stableRowId }, { TABLES }] = await Promise.all([
  import("../scripts/integration-fixture"), import("../src/lib/data/manage-occurrence-claim"),
  import("../src/lib/data/complete-occurrence"),
  import("../src/lib/domain/ids"), import("../src/lib/domain/schema"),
]);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type Trace = { reads: number; commits: number; readGate?: () => Promise<void>; readDelay?: number; commitGate?: () => Promise<void> };
const context = new AsyncLocalStorage<Trace>();
// tsx domain imports and this ESM runner can use different SDK exports. Patch
// both in this process only; no application server or network response is mocked.
const cjs = createRequire(import.meta.url)("node-appwrite") as { TablesDB: typeof TablesDB };
const originals = [...new Set([TablesDB.prototype, cjs.TablesDB.prototype])].map((prototype) => ({
  prototype, getRow: prototype.getRow, updateTransaction: prototype.updateTransaction,
}));
for (const { prototype, getRow, updateTransaction } of originals) {
  prototype.getRow = (async function (this: TablesDB, ...args: unknown[]) {
    const row = await Reflect.apply(getRow, this, args);
    const params = args[0] as { transactionId?: string; tableId?: string };
    const trace = context.getStore();
    if (trace && params.transactionId && params.tableId === TABLES.claims) {
      trace.reads++;
      await trace.readGate?.();
      if (trace.readDelay) await sleep(trace.readDelay);
    }
    return row;
  }) as typeof prototype.getRow;
  prototype.updateTransaction = (async function (this: TablesDB, ...args: unknown[]) {
    const trace = context.getStore();
    if ((args[0] as { commit?: boolean }).commit && trace) {
      await trace.commitGate?.();
      const result = await Reflect.apply(updateTransaction, this, args);
      trace.commits++;
      return result;
    }
    return Reflect.apply(updateTransaction, this, args);
  }) as typeof prototype.updateTransaction;
}

const {createSchedule,updateSchedule}=await import('../src/lib/data/manage-schedule');
const f=await integrationFixture('schedule');const {circleId,ownerId,caregiverId,tables,databaseId}=f;
const ids=new Set<string>();
const list=async(tableId:string,field:string,value:string)=>{const r=await tables.listRows({databaseId,tableId,queries:[Query.equal(field,[value]),Query.limit(100)],total:false});assert.ok(r.rows.length<100);return r.rows};
const info=(error:unknown)=>{const e=error as {code?:number;type?:string;message?:string;cause?:{code?:string}};return {status:e.code,type:e.type,message:e.message,name:(error as Error).name,cause:e.cause?.code}};
try{
 for(const mode of ['completion','claim','concurrent-edits']){
 const input={title:'Synthetic lifecycle probe',instruction:'Test only',localTime:'00:00',frequency:'daily' as const,active:true};
 const schedule=await createSchedule(circleId,ownerId,input);const occ=(await list(TABLES.occurrences,'scheduleId',schedule.$id))[0];assert.ok(occ);ids.add(occ.$id);
 assert.equal((await claimOccurrence(occ.$id,ownerId)).kind,'claimed');
 if(mode==='claim')await tables.updateRow({databaseId,tableId:TABLES.claims,rowId:stableRowId('clm',occ.$id),data:{expiresAt:new Date(Date.now()-60000).toISOString()}});
 const original=await tables.getRow({databaseId,tableId:TABLES.occurrences,rowId:occ.$id});
 let resume!:()=>void,saw!:()=>void;const gate=new Promise<void>(r=>resume=r),ready=new Promise<void>(r=>saw=r);
 const trace:Trace={reads:0,commits:0,readGate:async()=>{saw();await gate}};
 const pending=context.run(trace,()=>mode==='claim'?claimOccurrence(occ.$id,caregiverId):completeOccurrence({occurrenceId:occ.$id,actorId:ownerId,idempotencyKey:`lifecycle-${circleId}-${mode}`,outcome:'completed',occurredAt:new Date().toISOString()})).then(value=>({value,error:undefined}),error=>({value:undefined,error:info(error)}));
 let timer:ReturnType<typeof setTimeout>|undefined;let edits:unknown[]=[];let recreated;
 try{
 await Promise.race([ready,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Lease read hook missing')),15000)})]);clearTimeout(timer);
 const tomorrow=new Date(Date.now()+86400000).toISOString().slice(0,10);const exclude={...input,frequency:'once' as const,date:tomorrow};
 if(mode==='concurrent-edits'){const results=await Promise.allSettled([updateSchedule(circleId,schedule.$id,ownerId,exclude),updateSchedule(circleId,schedule.$id,ownerId,{...exclude,title:'Concurrent lifecycle edit'})]);edits=results.map(r=>r.status==='fulfilled'?{ok:true}:{error:info(r.reason)});for(const r of results)if(r.status==='rejected'&&(r.reason.code===503||r.reason.cause?.code))throw r.reason;}else await updateSchedule(circleId,schedule.$id,ownerId,exclude);
 assert.equal((await list(TABLES.occurrences,'scheduleId',schedule.$id)).length,0);
 await updateSchedule(circleId,schedule.$id,ownerId,input);
 recreated=(await list(TABLES.occurrences,'scheduleId',schedule.$id))[0];assert.equal(recreated.$id,occ.$id);assert.equal(recreated.version,0);
 }finally{clearTimeout(timer);resume();await pending;}
 const result=await pending;const final=await tables.getRow({databaseId,tableId:TABLES.occurrences,rowId:occ.$id});const events=await list(TABLES.events,'occurrenceId',occ.$id),receipts=await list(TABLES.commands,'occurrenceId',occ.$id);
 const record={mode,originalVersion:original.version,recreatedVersion:recreated?.version,sameId:original.$id===recreated?.$id,result,commits:trace.commits,final,events,receipts,edits};assert.equal(trace.commits,0,'Stale generation must not commit');assert.equal(events.length,0);assert.equal(receipts.length,0);if(mode==='claim'){assert.equal(result.value?.kind,'not_claimed')}else assert.equal(result.error?.name,'CompletionClaimRequiredError');
 console.log(JSON.stringify({mode,sameId:record.sameId,originalVersion:record.originalVersion,recreatedVersion:record.recreatedVersion,resultKind:result.value?.kind,error:result.error,commits:trace.commits,status:final.status,events:events.length,receipts:receipts.length,edits}));if(result.error?.status===503||result.error?.cause)throw Error('Infrastructure failure; stop');
 assert.equal((await claimOccurrence(occ.$id,caregiverId)).kind,'claimed');
 assert.equal((await completeOccurrence({occurrenceId:occ.$id,actorId:caregiverId,idempotencyKey:`fresh-${circleId}-${mode}`,outcome:'completed',occurredAt:new Date().toISOString()})).kind,'accepted');
 await updateSchedule(circleId,schedule.$id,ownerId,{...input,frequency:'once',date:new Date(Date.now()+86400000).toISOString().slice(0,10)});
 assert.equal((await tables.getRow({databaseId,tableId:TABLES.occurrences,rowId:occ.$id})).status,'completed');
 assert.equal((await list(TABLES.events,'occurrenceId',occ.$id)).length,1);assert.equal((await list(TABLES.commands,'occurrenceId',occ.$id)).length,1);
 }
}finally{
 for(const {prototype,getRow,updateTransaction} of originals){prototype.getRow=getRow;prototype.updateTransaction=updateTransaction;}
 for(const id of ids)for(const tableId of [TABLES.claims,TABLES.events,TABLES.commands])for(const row of await list(tableId,'occurrenceId',id))await tables.deleteRow({databaseId,tableId,rowId:row.$id});
 await f.cleanup();console.log('Lifecycle fixture cleanup complete');
}
