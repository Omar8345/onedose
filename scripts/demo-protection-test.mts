import assert from 'node:assert/strict';
import {archiveSchedule,ScheduleForbiddenError} from '../src/lib/data/manage-schedule';
import {createRequire} from 'node:module';
import {DEMO_ACCOUNTS,DEMO_TARGET} from '../src/lib/demo/config';
import {isProtectedCircle,isPublicDemoUser,isDemoCreatedSchedule} from '../src/lib/demo/protection';
import {POST as initiate} from '../src/app/api/auth/email/route';
import {POST as verify} from '../src/app/api/auth/verify/route';
const {Users,Account,AppwriteException,TablesDB}=createRequire(import.meta.url)('node-appwrite');
const originalGet=Users.prototype.get,originalToken=Account.prototype.createEmailToken,originalSession=Account.prototype.createSession;
const originalRow=TablesDB.prototype.getRow,originalUpdate=TablesDB.prototype.updateRow;
const saved={...process.env};let tokens=0,exchanges=0;
try{
 Object.assign(process.env,{NEXT_PUBLIC_APPWRITE_ENDPOINT:DEMO_TARGET.endpoint,NEXT_PUBLIC_APPWRITE_PROJECT_ID:DEMO_TARGET.projectId,NEXT_PUBLIC_APPWRITE_DATABASE_ID:DEMO_TARGET.databaseId,APPWRITE_API_KEY:'local-test-placeholder'});
 Users.prototype.get=async({userId}:{userId:string})=>{const a=Object.values(DEMO_ACCOUNTS).find(a=>a.id===userId)!;return {$id:a.id,email:a.email,emailVerification:true}};
 Account.prototype.createEmailToken=async()=>{tokens++;return {userId:'ordinary-user'}};
 Account.prototype.createSession=async()=>{exchanges++;throw new AppwriteException('Invalid code',401)};
 const request=(body:unknown)=>new Request('http://localhost/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 for(const a of Object.values(DEMO_ACCOUNTS)){
  assert.equal((await initiate(request({email:a.email}))).status,403);
  assert.equal((await verify(request({userId:a.id,secret:'123456'}))).status,403);
 }
 assert.equal(tokens,0);assert.equal(exchanges,0);
 assert.equal((await initiate(request({email:'ordinary@example.invalid'}))).status,200);
 assert.equal((await verify(request({userId:'ordinary-user',secret:'123456'}))).status,401);
 assert.equal(tokens,1);assert.equal(exchanges,1);
 assert.equal(isProtectedCircle('demo_mitchell_circle'),true);assert.equal(isProtectedCircle('other-circle'),false);
 assert.equal(isDemoCreatedSchedule('demo_mitchell_morning'),false);assert.equal(isDemoCreatedSchedule('public_demo_'+'a'.repeat(24)),true);
 let role='caregiver';
 TablesDB.prototype.getRow=async({tableId}:{tableId:string})=>tableId==='care_circles'?{$id:'ordinary-circle',teamId:'ordinary-team'}:tableId==='circle_members'?{circleId:'ordinary-circle',userId:'ordinary-user',status:'active',role}:{$id:'ordinary-schedule',circleId:'ordinary-circle',archivedAt:null};
 TablesDB.prototype.updateRow=async({data}:{data:unknown})=>data;
 await assert.rejects(archiveSchedule('ordinary-circle','ordinary-schedule','ordinary-user'),ScheduleForbiddenError);
 role='owner';assert.equal((await archiveSchedule('ordinary-circle','ordinary-schedule','ordinary-user')).active,false);
 process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID='another-project';
 assert.equal(isPublicDemoUser('demo_mitchell_sarah'),false);
 assert.equal((await initiate(request({email:DEMO_ACCOUNTS.sarah.email}))).status,200);
 console.log('PASS: all demo OTP initiations/exchanges blocked before Auth calls; ordinary users/other projects unchanged; schedule namespace policy. No live writes.');
}finally{TablesDB.prototype.getRow=originalRow;TablesDB.prototype.updateRow=originalUpdate;Users.prototype.get=originalGet;Account.prototype.createEmailToken=originalToken;Account.prototype.createSession=originalSession;for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}
