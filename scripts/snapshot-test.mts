import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {AppwriteException}=createRequire(import.meta.url)('node-appwrite');
import {snapshotResponse} from '../src/lib/data/snapshot-response';
import {CareCircleAccessError} from '../src/lib/data/get-care-circle';
import {demoCircle} from '../src/lib/demo-data';
for(const error of [new TypeError('fetch failed',{cause:{code:'ECONNRESET'}}),new TypeError('fetch failed',{cause:{code:'ENOTFOUND'}}),new AppwriteException('Service unavailable',503)]){
 const response=await snapshotResponse(async()=>{throw error});
 assert.equal(response.status,503);assert.equal((await response.json()).circle,undefined);
 assert.equal(response.headers.get('set-cookie'),null);
}
for(const [error,status]of [[new AppwriteException('Unauthorized',401),401],[new CareCircleAccessError(),403]] as const){
 const response=await snapshotResponse(async()=>{throw error});assert.equal(response.status,status);assert.equal((await response.json()).circle,undefined);
}
const recovered=await snapshotResponse(async()=>({circle:demoCircle,viewerId:"test-caregiver"}));
assert.equal(recovered.status,200);assert.equal(recovered.headers.get('cache-control'),'private, no-store');assert.equal((await recovered.json()).circle.id,demoCircle.id);
console.log('PASS: transport failures return 503 without private data or logout cookies; genuine 401/revocation stay distinct; subsequent success recovers.');
