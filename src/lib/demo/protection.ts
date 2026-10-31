import { DEMO_ACCOUNTS, DEMO_CIRCLE, DEMO_TEAM, DEMO_TARGET } from './config';
export const DEMO_RESTRICTION='This action is disabled in the public demo to keep the shared care circle available for everyone.';
export function isProtectedProject(){return process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID===DEMO_TARGET.projectId && process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID===DEMO_TARGET.databaseId && process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT===DEMO_TARGET.endpoint;}
export function isPublicDemoUser(id:string){return isProtectedProject() && Object.values(DEMO_ACCOUNTS).some(a=>a.id===id);}
export function isProtectedCircle(id:string){return isProtectedProject() && id===DEMO_CIRCLE;}
export function isProtectedTeam(id:string){return isProtectedProject() && id===DEMO_TEAM;}
// Only server-created schedule IDs in this reserved namespace are editable.
// Original seeded IDs are outside it. Clients cannot choose IDs on schedule creation.
export function isDemoCreatedSchedule(id:string){return /^public_demo_[a-f0-9]{24}$/.test(id);}
