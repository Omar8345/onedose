import assert from "node:assert/strict";

import nextEnv from "@next/env";
import type { MemberRow } from "../src/lib/domain/schema";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const [
  { CompletionForbiddenError, completeOccurrence },
  { CaregiverManagementForbiddenError, revokeCaregiverForOwner },
  { canRevokeMembership },
  { getServerAppwrite },
  { stableRowId },
  { TABLES },
] = await Promise.all([
  import("../src/lib/data/complete-occurrence"),
  import("../src/lib/data/manage-caregivers"),
  import("../src/lib/data/caregiver-policy"),
  import("../src/lib/appwrite/server"),
  import("../src/lib/domain/ids"),
  import("../src/lib/domain/schema"),
]);

const { databaseId, tables, teams, users } = getServerAppwrite();
const runId = Date.now().toString(36);
const ownerId = `proof_owner_${runId}`;
const caregiverId = `proof_carer_${runId}`;
const teamId = `proof_team_${runId}`;
const circleId = `proof_circle_${runId}`;
const occurrenceId = `proof_occ_${runId}`;
const ownerMembershipId = `proof_own_${runId}`;
const caregiverMembershipId = `proof_car_${runId}`;
const ownerRowId = stableRowId("mem", `${circleId}:${ownerId}`);
const caregiverRowId = stableRowId("mem", `${circleId}:${caregiverId}`);
const createdRows: Array<{ tableId: string; rowId: string }> = [];
let teamCreated = false;
const createdUsers: string[] = [];

function isMissing(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === 404;
}

try {
  await users.create({ userId: ownerId, email: `${ownerId}@example.invalid`, name: "Policy owner" });
  createdUsers.push(ownerId);
  await users.create({ userId: caregiverId, email: `${caregiverId}@example.invalid`, name: "Policy caregiver" });
  createdUsers.push(caregiverId);

  await teams.create({ teamId, name: "OneDose caregiver policy proof", roles: ["owner", "caregiver"] });
  teamCreated = true;
  await teams.createMembership({ teamId, membershipId: ownerMembershipId, userId: ownerId, roles: ["owner"] });
  await teams.createMembership({ teamId, membershipId: caregiverMembershipId, userId: caregiverId, roles: ["caregiver"] });

  await tables.createRow({ databaseId, tableId: TABLES.circles, rowId: circleId, data: {
    name: "Caregiver policy proof", teamId, timezone: "UTC", archivedAt: null,
  }, permissions: [] });
  createdRows.push({ tableId: TABLES.circles, rowId: circleId });
  await tables.createRow({ databaseId, tableId: TABLES.members, rowId: ownerRowId, data: {
    circleId, userId: ownerId, role: "owner", status: "active", lastMutationAt: null,
  }, permissions: [] });
  createdRows.push({ tableId: TABLES.members, rowId: ownerRowId });
  await tables.createRow({ databaseId, tableId: TABLES.members, rowId: caregiverRowId, data: {
    circleId, userId: caregiverId, role: "caregiver", status: "active", lastMutationAt: null,
  }, permissions: [] });
  createdRows.push({ tableId: TABLES.members, rowId: caregiverRowId });
  const dueAt = new Date().toISOString();
  await tables.createRow({ databaseId, tableId: TABLES.occurrences, rowId: occurrenceId, data: {
    circleId, teamId, scheduleId: `proof_sched_${runId}`, dueAt, status: "due", version: 0,
  }, permissions: [] });
  createdRows.push({ tableId: TABLES.occurrences, rowId: occurrenceId });

  await assert.rejects(
    revokeCaregiverForOwner({ ownerId, circleId, membershipId: ownerMembershipId }),
    CaregiverManagementForbiddenError,
    "the owner membership must be protected",
  );
  const ownerMember = await tables.getRow<MemberRow>({
    databaseId,
    tableId: TABLES.members,
    rowId: ownerRowId,
  });
  assert.equal(
    canRevokeMembership(
      ownerMember,
      { userId: "pending", roles: ["caregiver"], confirm: false },
      ownerId,
    ),
    true,
    "pending caregiver invitations must be cancellable",
  );

  await revokeCaregiverForOwner({ ownerId, circleId, membershipId: caregiverMembershipId });
  await assert.rejects(
    teams.getMembership({ teamId, membershipId: caregiverMembershipId }),
    (error: unknown) => isMissing(error),
    "the Appwrite Team membership must be deleted",
  );
  const revoked = await tables.getRow({ databaseId, tableId: TABLES.members, rowId: caregiverRowId });
  assert.equal(revoked.status, "revoked", "the persisted circle membership must be revoked");
  await assert.rejects(
    completeOccurrence({
      occurrenceId,
      actorId: caregiverId,
      idempotencyKey: `revoked-${runId}-request`,
      outcome: "completed",
      occurredAt: dueAt,
    }),
    CompletionForbiddenError,
    "the revoked caregiver's next mutation must be rejected",
  );

  console.log("Caregiver access integration proof passed");
  console.table({
    realTeamMembershipDeleted: true,
    persistedMemberRevoked: true,
    ownerProtection: true,
    pendingCancellationPolicy: true,
    revokedNextMutationRejected: true,
  });
} finally {
  for (const row of createdRows.reverse()) {
    await tables.deleteRow({ databaseId, tableId: row.tableId, rowId: row.rowId }).catch(() => undefined);
  }
  if (teamCreated) await teams.delete({ teamId }).catch(() => undefined);
  for (const userId of createdUsers.reverse()) await users.delete({ userId }).catch(() => undefined);
}
