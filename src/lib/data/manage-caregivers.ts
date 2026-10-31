import { protectDemoAdministration } from "@/lib/demo/guard";
import "server-only";

import { AppwriteException, Permission, Query, Role, type Models } from "node-appwrite";

import { getServerAppwrite } from "@/lib/appwrite/server";
import { requireCurrentUser } from "@/lib/auth/session";
import { stableRowId } from "@/lib/domain/ids";
import { TABLES, type MemberRow } from "@/lib/domain/schema";
import { canRevokeMembership } from "@/lib/data/caregiver-policy";

export class CaregiverManagementForbiddenError extends Error {
  constructor(message = "Only the care circle owner can manage caregivers.") {
    super(message);
    this.name = "CaregiverManagementForbiddenError";
  }
}

type CircleRow = Models.Row & { teamId: string };

function isMissing(error: unknown) {
  return error instanceof AppwriteException && error.code === 404;
}

export async function revokeCaregiver(membershipId: string) {
  const { user } = await requireCurrentUser();
  const circleId = user.prefs.circleId;
  if (!circleId) throw new CaregiverManagementForbiddenError("Set up your care circle first.");

  return revokeCaregiverForOwner({ ownerId: user.$id, circleId, membershipId });
}

export async function revokeCaregiverForOwner({
  ownerId,
  circleId,
  membershipId,
}: {
  ownerId: string;
  circleId: string;
  membershipId: string;
}) {

  protectDemoAdministration(circleId,ownerId);
  const { databaseId, tables, teams } = getServerAppwrite();
  const circle = await tables.getRow<CircleRow>({
    databaseId,
    tableId: TABLES.circles,
    rowId: circleId,
  });
  const teamId = circle.teamId;
  const owner = await tables.getRow<MemberRow>({
    databaseId,
    tableId: TABLES.members,
    rowId: stableRowId("mem", `${circleId}:${ownerId}`),
  });
  if (owner.circleId !== circleId || owner.userId !== ownerId || owner.role !== "owner" || owner.status !== "active") {
    throw new CaregiverManagementForbiddenError();
  }

  const memberships = await teams.listMemberships({
    teamId,
    queries: [Query.limit(100)],
    total: false,
  });
  const membership = memberships.memberships.find((item) => item.$id === membershipId);
  if (!membership) throw new CaregiverManagementForbiddenError("That caregiver is no longer part of this care circle.");
  if (!canRevokeMembership(owner, membership, ownerId)) {
    throw new CaregiverManagementForbiddenError("The circle owner cannot be revoked.");
  }

  const memberId = stableRowId("mem", `${circleId}:${membership.userId}`);
  const now = new Date().toISOString();
  try {
    await tables.updateRow<MemberRow>({
      databaseId,
      tableId: TABLES.members,
      rowId: memberId,
      data: { status: "revoked", lastMutationAt: now },
    });
  } catch (error) {
    if (!isMissing(error)) throw error;
    await tables.createRow<MemberRow>({
      databaseId,
      tableId: TABLES.members,
      rowId: memberId,
      data: {
        circleId,
        userId: membership.userId,
        role: membership.roles.includes("viewer") ? "viewer" : "caregiver",
        status: "revoked",
        lastMutationAt: now,
      },
      permissions: [Permission.read(Role.team(teamId))],
    });
  }

  try {
    await teams.deleteMembership({ teamId, membershipId });
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}
