import assert from "node:assert/strict";

import nextEnv from "@next/env";
import { Query, type Models } from "node-appwrite";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const [{ completeOccurrence }, { getCareCircle }, { getServerAppwrite }, { stableRowId }, { TABLES }] = await Promise.all([
  import("../src/lib/data/complete-occurrence"),
  import("../src/lib/data/get-care-circle"),
  import("../src/lib/appwrite/server"),
  import("../src/lib/domain/ids"),
  import("../src/lib/domain/schema"),
]);

const REQUEST_COUNT = 25;
const runId = Date.now().toString(36);
const circleId = `race_circle_${runId}`;
const teamId = `race_team_${runId}`;
const scheduleId = `race_sched_${runId}`;
const recipientId = `race_rec_${runId}`;
const occurrenceId = `race_occ_${runId}`;
const actors = [`race_owner_${runId}`, `race_carer_${runId}`] as const;
const memberships = [`race_own_${runId}`, `race_car_${runId}`] as const;
const dueAt = new Date().toISOString();
const { databaseId, tables, teams, users } = getServerAppwrite();
let setupComplete = false;

async function rowsFor(tableId: string) {
  return tables.listRows({ databaseId, tableId, queries: [Query.equal("occurrenceId", [occurrenceId]), Query.limit(100)], total: false });
}

async function removeRows(tableId: string, rows: Models.Row[]) {
  for (const row of rows) await tables.deleteRow({ databaseId, tableId, rowId: row.$id });
}

async function cleanup() {
  if (!setupComplete || process.env.KEEP_RACE_DATA === "1") return;
  const [events, commands] = await Promise.all([rowsFor(TABLES.events), rowsFor(TABLES.commands)]);
  await removeRows(TABLES.commands, commands.rows);
  await removeRows(TABLES.events, events.rows);
  await tables.deleteRow({ databaseId, tableId: TABLES.occurrences, rowId: occurrenceId }).catch(() => undefined);
  await tables.deleteRow({ databaseId, tableId: TABLES.circleSettings, rowId: stableRowId("set", circleId) }).catch(() => undefined);
  for (const actorId of actors) {
    await tables.deleteRow({ databaseId, tableId: TABLES.caregiverPreferences, rowId: stableRowId("pref", `${circleId}:${actorId}`) }).catch(() => undefined);
    await tables.deleteRow({ databaseId, tableId: TABLES.members, rowId: stableRowId("mem", `${circleId}:${actorId}`) }).catch(() => undefined);
  }
  await tables.deleteRow({ databaseId, tableId: TABLES.schedules, rowId: scheduleId }).catch(() => undefined);
  await tables.deleteRow({ databaseId, tableId: TABLES.recipients, rowId: recipientId }).catch(() => undefined);
  await tables.deleteRow({ databaseId, tableId: TABLES.circles, rowId: circleId }).catch(() => undefined);
  await teams.delete({ teamId }).catch(() => undefined);
  for (const userId of actors) await users.delete({ userId }).catch(() => undefined);
}

try {
  setupComplete = true;
  for (const [index, userId] of actors.entries()) {
    await users.create({ userId, email: `${userId}@example.invalid`, name: index === 0 ? "Race owner" : "Race caregiver" });
  }
  await teams.create({ teamId, name: "OneDose race proof", roles: ["owner", "caregiver"] });
  await teams.createMembership({ teamId, membershipId: memberships[0], userId: actors[0], roles: ["owner"] });
  await teams.createMembership({ teamId, membershipId: memberships[1], userId: actors[1], roles: ["caregiver"] });
  await tables.createRow({ databaseId, tableId: TABLES.circles, rowId: circleId, data: { name: "Race proof care", teamId, timezone: "UTC", archivedAt: null }, permissions: [] });
  await tables.createRow({ databaseId, tableId: TABLES.recipients, rowId: recipientId, data: { circleId, displayName: "Race proof", archivedAt: null }, permissions: [] });
  await tables.createRow({ databaseId, tableId: TABLES.schedules, rowId: scheduleId, data: {
    circleId, recipientId, title: "Concurrent care action", instruction: "Race proof", localTime: "12:00", timezone: "UTC", rrule: "FREQ=DAILY", active: true,
  }, permissions: [] });
  for (const [index, userId] of actors.entries()) {
    await tables.createRow({ databaseId, tableId: TABLES.members, rowId: stableRowId("mem", `${circleId}:${userId}`), data: {
      circleId, userId, role: index === 0 ? "owner" : "caregiver", status: "active", lastMutationAt: null,
    }, permissions: [] });
    await tables.createRow({ databaseId, tableId: TABLES.caregiverPreferences, rowId: stableRowId("pref", `${circleId}:${userId}`), data: {
      circleId, userId, availability: "available", updatedAt: dueAt,
    }, permissions: [] });
  }
  await tables.createRow({ databaseId, tableId: TABLES.circleSettings, rowId: stableRowId("set", circleId), data: {
    circleId, primaryUserId: actors[0], escalationMinutes: 60, updatedAt: dueAt,
  }, permissions: [] });
  await tables.createRow({ databaseId, tableId: TABLES.occurrences, rowId: occurrenceId, data: {
    circleId, teamId, scheduleId, dueAt, status: "due", version: 0,
  }, permissions: [] });
  const [ownerBefore, caregiverBefore] = await Promise.all([
    getCareCircle(circleId, { id: actors[0], name: "Race owner" }),
    getCareCircle(circleId, { id: actors[1], name: "Race caregiver" }),
  ]);
  assert.equal(ownerBefore.occurrences.find((item) => item.id === occurrenceId)?.status, "due");
  assert.equal(caregiverBefore.occurrences.find((item) => item.id === occurrenceId)?.status, "due");

  console.log(`Two authenticated caregivers see ${occurrenceId}. Launching ${REQUEST_COUNT} simultaneous requests...`);
  const startedAt = performance.now();
  const results = await Promise.all(Array.from({ length: REQUEST_COUNT }, (_, index) => completeOccurrence({
    occurrenceId,
    actorId: actors[index % actors.length],
    idempotencyKey: `race-${runId}-${String(index).padStart(2, "0")}-request`,
    outcome: "completed",
    note: `Concurrent request ${index + 1}`,
    occurredAt: dueAt,
  })));
  const elapsedMs = Math.round(performance.now() - startedAt);

  const accepted = results.filter((result) => result.kind === "accepted");
  const conflicts = results.filter((result) => result.kind === "already_recorded");
  const [occurrence, events, commands, ownerAfter, caregiverAfter] = await Promise.all([
    tables.getRow({ databaseId, tableId: TABLES.occurrences, rowId: occurrenceId }),
    rowsFor(TABLES.events),
    rowsFor(TABLES.commands),
    getCareCircle(circleId, { id: actors[0], name: "Race owner" }),
    getCareCircle(circleId, { id: actors[1], name: "Race caregiver" }),
  ]);

  assert.equal(accepted.length, 1, "exactly one request must be accepted");
  assert.equal(conflicts.length, REQUEST_COUNT - 1, "every other request must observe the winner");
  assert.equal(occurrence.version, 1);
  assert.equal(events.rows.length, 1);
  assert.equal(commands.rows.length, 1);
  assert.equal(ownerAfter.occurrences.find((item) => item.id === occurrenceId)?.status, "completed");
  assert.equal(caregiverAfter.occurrences.find((item) => item.id === occurrenceId)?.status, "completed");

  console.log("\nOneDose concurrency proof passed");
  console.table({ requests: REQUEST_COUNT, authenticatedCaregiverViews: 2, accepted: accepted.length, conflicts: conflicts.length, auditEvents: events.rows.length, commandReceipts: commands.rows.length, finalVersion: occurrence.version, winner: occurrence.completedBy, converged: true, elapsedMs });
} finally {
  await cleanup();
}
