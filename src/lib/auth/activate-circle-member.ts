import "server-only";
import { AppwriteException, Permission, Query, Role } from "node-appwrite";
import { getServerAppwrite } from "@/lib/appwrite/server";
import { stableRowId } from "@/lib/domain/ids";
import { TABLES, type MemberRow } from "@/lib/domain/schema";
import { readMembershipFence, fenceMembership, CaregiverMutationConflictError } from "@/lib/data/membership-fence";
import { isOccurrenceConflict } from "@/lib/data/occurrence-fence";
import { requireTeamMembership } from "@/lib/data/team-authorization";
import { InvitationActivationUnavailableError, requireActiveMembershipForActivation } from "./activation-policy";

export async function checkConfirmedInvitation(teamId: string, userId: string) {
  await requireTeamMembership(teamId, userId);
  const { tables, databaseId } = getServerAppwrite();
  const circles = await tables.listRows({ databaseId, tableId: TABLES.circles,
    queries: [Query.equal("teamId", [teamId]), Query.limit(1)], total: false });
  const circle = circles.rows[0];
  if (!circle) throw new InvitationActivationUnavailableError();
  try {
    const member = await tables.getRow<MemberRow>({ databaseId, tableId: TABLES.members, rowId: stableRowId("mem", `${circle.$id}:${userId}`) });
    requireActiveMembershipForActivation(member, circle.$id, userId);
  } catch (error) {
    if (!(error instanceof AppwriteException && error.code === 404)) throw error;
  }
}

// A fresh invitation creates membership atomically with its permanent counter.
// Existing rows are never reset, restored, or promoted by login/activation.
export async function activateCircleMember(circleId: string, teamId: string, userId: string, role: MemberRow["role"]) {
  await requireTeamMembership(teamId, userId, role === "owner");
  const { tables, databaseId } = getServerAppwrite();
  const circle = await tables.getRow({ databaseId, tableId: TABLES.circles, rowId: circleId });
  if (circle.teamId !== teamId) throw new InvitationActivationUnavailableError();
  const memberId = stableRowId("mem", `${circleId}:${userId}`);
  const transaction = await tables.createTransaction({ ttl: 60 });
  try {
    const fence = await readMembershipFence(tables, databaseId, circleId, memberId, transaction.$id, true);
    let existing: MemberRow | undefined;
    try { existing = await tables.getRow<MemberRow>({ databaseId, tableId: TABLES.members, rowId: memberId, transactionId: transaction.$id }); }
    catch (error) { if (!(error instanceof AppwriteException && error.code === 404)) throw error; }
    if (existing) {
      requireActiveMembershipForActivation(existing, circleId, userId);
      await tables.updateTransaction({ transactionId: transaction.$id, rollback: true });
      return;
    }
    await fenceMembership(tables, databaseId, fence, transaction.$id);
    await tables.createRow({ databaseId, tableId: TABLES.members, rowId: memberId,
      data: { circleId, userId, role, status: "active", lastMutationAt: null },
      permissions: [Permission.read(Role.team(teamId))], transactionId: transaction.$id });
    await tables.updateTransaction({ transactionId: transaction.$id, commit: true });
  } catch (error) {
    await tables.updateTransaction({ transactionId: transaction.$id, rollback: true }).catch(() => undefined);
    if (isOccurrenceConflict(error)) throw new CaregiverMutationConflictError();
    throw error;
  }
}
