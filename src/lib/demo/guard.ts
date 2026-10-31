import 'server-only';
import { AppwriteException, Query } from 'node-appwrite';
import { getServerAppwrite } from '@/lib/appwrite/server';
import { DEMO_ACCOUNTS, DEMO_TEAM } from './config';
import { DEMO_RESTRICTION,isProtectedProject,isProtectedCircle,isProtectedTeam,isPublicDemoUser } from './protection';
export class PublicDemoRestriction extends AppwriteException {constructor(){super(DEMO_RESTRICTION,403,'public_demo_restricted');}}
export function protectDemoAdministration(circleId?:string,userId?:string,teamId?:string){if(isProtectedCircle(circleId??'') || isProtectedTeam(teamId??'') || isPublicDemoUser(userId??''))throw new PublicDemoRestriction();}
export async function isDemoOtpIdentity(input:{email?:string;userId?:string}){
 if(!isProtectedProject())return false;
 const actor=Object.values(DEMO_ACCOUNTS).find(a=>input.userId?a.id===input.userId:a.email===input.email?.trim().toLowerCase());
 if(!actor)return false;
 const user=await getServerAppwrite().users.get({userId:actor.id});
 if(user.$id!==actor.id || user.email!==actor.email || !user.emailVerification)throw new PublicDemoRestriction();
 return true;
}
export async function requireDemoScheduleIdentity(userId:string){
 const actor=Object.values(DEMO_ACCOUNTS).find(a=>a.id===userId);
 if(!actor)throw new PublicDemoRestriction();
 const user=await getServerAppwrite().users.get({userId});
 const memberships=await getServerAppwrite().teams.listMemberships({teamId:DEMO_TEAM,queries:[Query.equal("userId",[userId])]});
 if(user.email!==actor.email || !user.emailVerification || !user.status || !memberships.memberships.some(m=>m.confirm))throw new PublicDemoRestriction();
}
