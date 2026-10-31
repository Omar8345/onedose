import { protectDemoAdministration } from "@/lib/demo/guard";
import "server-only";

import { cookies } from "next/headers";
import { AppwriteException, Permission, Query, Role, type Models } from "node-appwrite";

import { getServerAppwrite } from "@/lib/appwrite/server";
import { getSessionServices, type OneDosePrefs } from "@/lib/auth/session";
import { stableRowId } from "@/lib/domain/ids";
import { TABLES, type MemberRow } from "@/lib/domain/schema";

const PENDING_TEAM_COOKIE = "onedose_pending_team";
const PENDING_TEAM_MAX_AGE_SECONDS = 30 * 60;

type CircleRow = Models.Row & { teamId: string };

export async function rememberPendingTeam(teamId: string) {
  protectDemoAdministration(undefined,undefined,teamId);
  (await cookies()).set(PENDING_TEAM_COOKIE, teamId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: PENDING_TEAM_MAX_AGE_SECONDS,
  });
}

export async function clearPendingTeam() {
  (await cookies()).set(PENDING_TEAM_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export async function getPendingTeam() {
  return (await cookies()).get(PENDING_TEAM_COOKIE)?.value ?? null;
}

export async function activateTeamForSession(secret: string, teamId: string) {
  const { account, teams } = getSessionServices(secret);
  const user = await account.get<OneDosePrefs>();
  protectDemoAdministration(undefined,user.$id,teamId);
  const teamList = await teams.list({ total: false });
  if (!teamList.teams.some((team) => team.$id === teamId)) return false;

  const memberships = await teams.listMemberships({ teamId, total: false });
  const membership = memberships.memberships.find(
    (item) => item.userId === user.$id && item.confirm,
  );
  if (!membership) return false;

  const { databaseId, tables } = getServerAppwrite();
  const circles = await tables.listRows<CircleRow>({
    databaseId,
    tableId: TABLES.circles,
    queries: [Query.equal("teamId", [teamId]), Query.limit(1)],
    total: false,
  });
  const circle = circles.rows[0];
  if (!circle) throw new Error("The invited care circle no longer exists.");

  const memberId = stableRowId("mem", `${circle.$id}:${user.$id}`);
  const role: MemberRow["role"] = membership.roles.includes("owner") ? "owner" : "caregiver";

  try {
    await tables.createRow({
      databaseId,
      tableId: TABLES.members,
      rowId: memberId,
      data: {
        circleId: circle.$id,
        userId: user.$id,
        role,
        status: "active",
        lastMutationAt: null,
      },
      permissions: [Permission.read(Role.team(teamId))],
    });
  } catch (error) {
    if (!(error instanceof AppwriteException && error.code === 409)) throw error;
    await tables.updateRow({
      databaseId,
      tableId: TABLES.members,
      rowId: memberId,
      data: { role, status: "active" },
    });
  }

  await account.updatePrefs<OneDosePrefs>({
    prefs: { ...user.prefs, primaryTeamId: teamId, circleId: circle.$id },
  });
  await clearPendingTeam();
  return true;
}

export async function activatePendingTeam(secret: string) {
  const teamId = await getPendingTeam();
  if (!teamId) return false;
  return activateTeamForSession(secret, teamId);
}
