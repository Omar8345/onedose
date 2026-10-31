import { DEMO_ACCOUNTS, DEMO_CIRCLE, DEMO_TEAM } from "./config";
export function validDemoActor(
  actor: (typeof DEMO_ACCOUNTS)[keyof typeof DEMO_ACCOUNTS],
  user: { email: string; status: boolean; prefs: Record<string, unknown> },
  member: { circleId: string; userId: string; status: string; role: string },
  memberships: { confirm: boolean; roles: string[] }[],
) {
  return user.email===actor.email && user.status && user.prefs.circleId===DEMO_CIRCLE && user.prefs.primaryTeamId===DEMO_TEAM
    && member.circleId===DEMO_CIRCLE && member.userId===actor.id && member.status==="active" && member.role===actor.role
    && memberships.some(m=>m.confirm && m.roles.includes(actor.role));
}
