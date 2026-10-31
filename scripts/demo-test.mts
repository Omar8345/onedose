import { createDemoLimiter } from "../src/lib/demo/rate-limit";
import assert from "node:assert/strict";
import { assertDemoTarget, DEMO_ACCOUNTS, DEMO_TARGET, DEMO_CIRCLE, DEMO_TEAM, demoOrigin } from "../src/lib/demo/config";
import { validDemoActor } from "../src/lib/demo/access";
import { GET, POST } from "../src/app/api/auth/demo/route";

const saved={...process.env};
try {
  const env={NEXT_PUBLIC_APPWRITE_ENDPOINT:DEMO_TARGET.endpoint,NEXT_PUBLIC_APPWRITE_PROJECT_ID:DEMO_TARGET.projectId,NEXT_PUBLIC_APPWRITE_DATABASE_ID:DEMO_TARGET.databaseId};
  assertDemoTarget(env);
  assert.throws(()=>assertDemoTarget({...env,NEXT_PUBLIC_APPWRITE_PROJECT_ID:"unrelated"}));
  assert.equal(demoOrigin(env),null);
  assert.equal(demoOrigin({...env,ONEDOSE_DEMO_ENABLED:"true",ONEDOSE_DEMO_ORIGIN:"https://attacker.invalid"}),null);
  Object.assign(process.env,env,{ONEDOSE_DEMO_ENABLED:"false"});
  assert.equal((await GET()).status,200);
  assert.equal((await POST(new Request("http://localhost:3000/api/auth/demo",{method:"POST"}))).status,404);
  Object.assign(process.env,{ONEDOSE_DEMO_ENABLED:"true",ONEDOSE_DEMO_ORIGIN:"http://localhost:3000"});
  const request=(body:unknown,origin="http://localhost:3000")=>new Request("http://localhost:3000/api/auth/demo",{method:"POST",headers:{Origin:origin,"Content-Type":"application/json"},body:JSON.stringify(body)});
  assert.equal((await POST(request({account:"sarah"},"https://attacker.invalid"))).status,403);
  for(const body of [{account:"omar"},{email:DEMO_ACCOUNTS.sarah.email},{account:"sarah",userId:"other"},{account:"sarah",secret:"123456"}]) assert.equal((await POST(request(body))).status,400);
  const limiter=createDemoLimiter(2);
  assert.equal(limiter(0),true); assert.equal(limiter(0),true); assert.equal(limiter(0),false); assert.equal(limiter(60000),true);
  for(const actor of Object.values(DEMO_ACCOUNTS)) {
    const user={email:actor.email,status:true,prefs:{circleId:DEMO_CIRCLE,primaryTeamId:DEMO_TEAM}};
    const member={circleId:DEMO_CIRCLE,userId:actor.id,status:"active",role:actor.role};
    const memberships=[{confirm:true,roles:[actor.role]}];
    assert.equal(validDemoActor(actor,user,member,memberships),true);
    assert.equal(validDemoActor(actor,{...user,email:"other@example.invalid"},member,memberships),false);
    assert.equal(validDemoActor(actor,user,{...member,status:"revoked"},memberships),false);
    assert.equal(validDemoActor(actor,user,member,[]),false);
    assert.equal(validDemoActor(actor,user,{...member,role:"viewer"},memberships),false);
  }
  console.log("PASS: demo configuration, origin and selection rejection, exact identity/role checks, local rate window. No live writes.");

} finally { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env,saved); }
