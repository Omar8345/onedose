import "server-only";

import { AppwriteException, Permission, Query, Role } from "node-appwrite";

import { getServerAppwrite } from "@/lib/appwrite/server";
import { canReadOrRecordCircle } from "@/lib/data/caregiver-policy";
import { stableRowId } from "@/lib/domain/ids";
import { TABLES, type MemberRow, type OccurrenceClaimRow, type OccurrenceRow } from "@/lib/domain/schema";

const TRANSACTION_TTL_SECONDS = 60;
export const CLAIM_LEASE_MINUTES = 15;

export type OccurrenceClaimResult = {
  kind: "claimed" | "already_claimed" | "already_recorded" | "released" | "not_claimed";
  occurrence: OccurrenceRow;
};

export class ClaimForbiddenError extends Error {
  constructor() {
    super("The caregiver is not allowed to update this care circle.");
    this.name = "ClaimForbiddenError";
  }
}

function isMissing(error: unknown) {
  return error instanceof AppwriteException && error.code === 404;
}

function isConflict(error: unknown) {
  return error instanceof AppwriteException && error.code === 409;
}

function hasActiveClaim(claim: OccurrenceClaimRow, now = Date.now()) {
  return Date.parse(claim.expiresAt) > now;
}

function withClaim(occurrence: OccurrenceRow, claim?: OccurrenceClaimRow): OccurrenceRow {
  return {
    ...occurrence,
    claimedBy: claim?.actorId ?? null,
    claimedAt: claim?.claimedAt ?? null,
    claimExpiresAt: claim?.expiresAt ?? null,
  };
}

async function activeMember(occurrence: OccurrenceRow, actorId: string, transactionId?: string) {
  const { databaseId, tables } = getServerAppwrite();
  try {
    const member = await tables.getRow<MemberRow>({
      databaseId,
      tableId: TABLES.members,
      rowId: stableRowId("mem", `${occurrence.circleId}:${actorId}`),
      transactionId,
    });
    if (member.circleId !== occurrence.circleId || !canReadOrRecordCircle(member, actorId)) throw new ClaimForbiddenError();
    return member;
  } catch (error) {
    if (isMissing(error)) throw new ClaimForbiddenError();
    throw error;
  }
}

// Re-read after contention: the winning lease may already have ended or moved.
export async function getOccurrenceClaimState(occurrenceId: string, actorId: string): Promise<OccurrenceClaimResult> {
  const { databaseId, tables, teams } = getServerAppwrite();
  let occurrence = await tables.getRow<OccurrenceRow>({ databaseId, tableId: TABLES.occurrences, rowId: occurrenceId });
  await activeMember(occurrence, actorId);
  const memberships = await teams.listMemberships({ teamId: occurrence.teamId, queries: [Query.equal("userId", [actorId])] });
  if (!memberships.memberships.some((member) => member.confirm)) throw new ClaimForbiddenError();
  let claim: OccurrenceClaimRow | undefined;
  try {
    claim = await tables.getRow<OccurrenceClaimRow>({ databaseId, tableId: TABLES.claims, rowId: stableRowId("clm", occurrenceId) });
  } catch (error) { if (!isMissing(error)) throw error; }
  occurrence = await tables.getRow<OccurrenceRow>({ databaseId, tableId: TABLES.occurrences, rowId: occurrenceId });
  await activeMember(occurrence, actorId);
  if (occurrence.status !== "due") return { kind: "already_recorded", occurrence: withClaim(occurrence) };
  const active = claim && hasActiveClaim(claim) && occurrence.claimedBy === claim.actorId
    && occurrence.claimedAt === claim.claimedAt;
  return { kind: active ? "already_claimed" : "not_claimed", occurrence: withClaim(occurrence, active ? claim : undefined) };
}

export async function claimOccurrence(occurrenceId: string, actorId: string): Promise<OccurrenceClaimResult> {
  const { databaseId, tables } = getServerAppwrite();
  const transaction = await tables.createTransaction({ ttl: TRANSACTION_TTL_SECONDS });
  try {
    const occurrence = await tables.getRow<OccurrenceRow>({
      databaseId,
      tableId: TABLES.occurrences,
      rowId: occurrenceId,
      transactionId: transaction.$id,
    });
    const member = await activeMember(occurrence, actorId, transaction.$id);
    if (occurrence.status !== "due") {
      await tables.updateTransaction({ transactionId: transaction.$id, rollback: true });
      return { kind: "already_recorded", occurrence };
    }
    const claimId = stableRowId("clm", occurrenceId);
    let existingClaim: OccurrenceClaimRow | null = null;
    try {
      existingClaim = await tables.getRow<OccurrenceClaimRow>({
        databaseId,
        tableId: TABLES.claims,
        rowId: claimId,
        transactionId: transaction.$id,
      });
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    if (existingClaim && hasActiveClaim(existingClaim)) {
      await tables.updateTransaction({ transactionId: transaction.$id, rollback: true });
      return { kind: "already_claimed", occurrence: withClaim(occurrence, existingClaim) };
    }

    const now = new Date();
    const claimedAt = now.toISOString();
    const claimExpiresAt = new Date(now.getTime() + CLAIM_LEASE_MINUTES * 60_000).toISOString();
    await tables.updateRow<MemberRow>({
      databaseId,
      tableId: TABLES.members,
      rowId: member.$id,
      data: { lastMutationAt: claimedAt },
      transactionId: transaction.$id,
    });
    if (existingClaim) {
      await tables.deleteRow({
        databaseId,
        tableId: TABLES.claims,
        rowId: claimId,
        transactionId: transaction.$id,
      });
    }
    await tables.createRow({
      databaseId,
      tableId: TABLES.claims,
      rowId: claimId,
      data: { circleId: occurrence.circleId, occurrenceId, actorId, claimedAt, expiresAt: claimExpiresAt },
      permissions: [Permission.read(Role.team(occurrence.teamId))],
      transactionId: transaction.$id,
    });
    await tables.updateRow<OccurrenceRow>({
      databaseId,
      tableId: TABLES.occurrences,
      rowId: occurrence.$id,
      data: {
        claimedBy: actorId,
        claimedAt,
        claimExpiresAt,
        version: occurrence.version + 1,
      },
      transactionId: transaction.$id,
    });
    await tables.updateTransaction({ transactionId: transaction.$id, commit: true });
    const [committed, claim] = await Promise.all([
      tables.getRow<OccurrenceRow>({ databaseId, tableId: TABLES.occurrences, rowId: occurrenceId }),
      tables.getRow<OccurrenceClaimRow>({ databaseId, tableId: TABLES.claims, rowId: claimId }),
    ]);
    return { kind: "claimed", occurrence: withClaim(committed, claim) };
  } catch (error) {
    await tables.updateTransaction({ transactionId: transaction.$id, rollback: true }).catch(() => undefined);
    if (!isConflict(error)) throw error;
    return getOccurrenceClaimState(occurrenceId, actorId);
  }
}

export async function releaseOccurrenceClaim(occurrenceId: string, actorId: string): Promise<OccurrenceClaimResult> {
  const { databaseId, tables } = getServerAppwrite();
  const transaction = await tables.createTransaction({ ttl: TRANSACTION_TTL_SECONDS });
  try {
    const occurrence = await tables.getRow<OccurrenceRow>({
      databaseId,
      tableId: TABLES.occurrences,
      rowId: occurrenceId,
      transactionId: transaction.$id,
    });
    const member = await activeMember(occurrence, actorId, transaction.$id);
    let claim: OccurrenceClaimRow;
    try {
      claim = await tables.getRow<OccurrenceClaimRow>({
        databaseId,
        tableId: TABLES.claims,
        rowId: stableRowId("clm", occurrenceId),
        transactionId: transaction.$id,
      });
    } catch (error) {
      if (isMissing(error)) {
        await tables.updateTransaction({ transactionId: transaction.$id, rollback: true });
        return { kind: "not_claimed", occurrence: withClaim(occurrence) };
      }
      throw error;
    }
    if (claim.actorId !== actorId || !hasActiveClaim(claim)) {
      await tables.updateTransaction({ transactionId: transaction.$id, rollback: true });
      return { kind: "not_claimed", occurrence: withClaim(occurrence, hasActiveClaim(claim) ? claim : undefined) };
    }
    const now = new Date().toISOString();
    await tables.updateRow<MemberRow>({
      databaseId,
      tableId: TABLES.members,
      rowId: member.$id,
      data: { lastMutationAt: now },
      transactionId: transaction.$id,
    });
    await tables.updateRow<OccurrenceRow>({
      databaseId,
      tableId: TABLES.occurrences,
      rowId: occurrence.$id,
      data: { claimedBy: null, claimedAt: null, claimExpiresAt: null, version: occurrence.version + 1 },
      transactionId: transaction.$id,
    });
    await tables.deleteRow({
      databaseId,
      tableId: TABLES.claims,
      rowId: claim.$id,
      transactionId: transaction.$id,
    });
    await tables.updateTransaction({ transactionId: transaction.$id, commit: true });
    const committed = await tables.getRow<OccurrenceRow>({ databaseId, tableId: TABLES.occurrences, rowId: occurrenceId });
    return { kind: "released", occurrence: committed };
  } catch (error) {
    await tables.updateTransaction({ transactionId: transaction.$id, rollback: true }).catch(() => undefined);
    if (!isMissing(error) && !isConflict(error)) throw error;
    return getOccurrenceClaimState(occurrenceId, actorId);
  }
}
