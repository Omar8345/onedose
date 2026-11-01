import "server-only";

import { AppwriteException, type TablesDB, type Models } from "node-appwrite";
import { stableRowId } from "@/lib/domain/ids";
import { TABLES } from "@/lib/domain/schema";

type MembershipFence = Models.Row & { circleId: string; occurrenceId: string; version: number };

// The legacy column name occurrenceId stores the resource ID. The auth_ namespace
// is disjoint from fence_ occurrence counters. Never delete a production counter.
// Read BEFORE membership; otherwise revocation between these reads could be missed.
export async function readMembershipFence(tables: TablesDB, databaseId: string, circleId: string, memberId: string, transactionId: string, revoking = false) {
  const rowId = stableRowId("auth", memberId);
  let fence: MembershipFence;
  try {
    fence = await tables.getRow<MembershipFence>({ databaseId, tableId: TABLES.fences, rowId, transactionId });
  } catch (error) {
    if (!(error instanceof AppwriteException && error.code === 404)) throw error;
    if (!revoking) {
      const member = await tables.getRow({ databaseId, tableId: TABLES.members, rowId: memberId, transactionId });
      if (member.circleId !== circleId || member.status !== "active") throw new AppwriteException("Caregiver access is not active.", 403, "onedose_forbidden");
    }
    try {
      await tables.createRow({ databaseId, tableId: TABLES.fences, rowId,
        data: { circleId, occurrenceId: memberId, version: 0 }, permissions: [] });
    } catch (creationError) {
      if (!(creationError instanceof AppwriteException && creationError.code === 409)) throw creationError;
    }
    fence = await tables.getRow<MembershipFence>({ databaseId, tableId: TABLES.fences, rowId, transactionId });
  }
  if (fence.circleId !== circleId || fence.occurrenceId !== memberId) throw new Error("Membership fence ownership mismatch.");
  return fence;
}

export async function fenceMembership(tables: TablesDB, databaseId: string, fence: MembershipFence, transactionId: string) {
  await tables.incrementRowColumn({ databaseId, tableId: TABLES.fences, rowId: fence.$id,
    column: "version", value: 1, max: fence.version + 1, transactionId });
}

export class CaregiverMutationConflictError extends Error {
  constructor() {
    super("Another change by this caregiver finished during this request. Refresh and try again.");
    this.name = "CaregiverMutationConflictError";
  }
}

// Only classify known rejected transactions, never ambiguous provider failures.
// A changed actor counter with an unchanged target counter is not a lost lease.
export async function membershipChangedWithoutOccurrenceChange(
  tables: TablesDB, databaseId: string,
  membership: { $id: string; version: number } | undefined,
  occurrence: { $id: string; version: number } | undefined,
) {
  if (!membership || !occurrence) return false;
  const [currentMember, currentOccurrence] = await Promise.all([
    tables.getRow<MembershipFence>({ databaseId, tableId: TABLES.fences, rowId: membership.$id }),
    tables.getRow<MembershipFence>({ databaseId, tableId: TABLES.fences, rowId: occurrence.$id }),
  ]);
  return currentMember.version !== membership.version && currentOccurrence.version === occurrence.version;
}
