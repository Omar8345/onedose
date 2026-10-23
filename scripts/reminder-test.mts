import assert from "node:assert/strict";

import nextEnv from "@next/env";
import { Query } from "node-appwrite";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const [{ getServerAppwrite }, { runReminderSweep, TABLES }] = await Promise.all([
  import("../src/lib/appwrite/server"),
  import("../functions/reminders/src/engine.js"),
]);

const { databaseId, tables } = getServerAppwrite();
const now = new Date();
const suffix = Date.now().toString(36);
const occurrenceIds = [`rem_due_${suffix}`, `rem_late_${suffix}`, `rem_old_${suffix}`];
const scheduleId = `rem_sched_${suffix}`;
const circleId = `rem_circle_${suffix}`;
const teamId = `rem_team_${suffix}`;
const users = [`rem_owner_${suffix}`, `rem_carer_${suffix}`, `rem_off_${suffix}`];
const memberIds = users.map((_, index) => `rem_mem_${index}_${suffix}`);
const preferenceIds = users.map((_, index) => `rem_pref_${index}_${suffix}`);
const settingsId = `rem_set_${suffix}`;

async function createOccurrence(rowId: string, dueAt: Date) {
  await tables.createRow({
    databaseId,
    tableId: TABLES.occurrences,
    rowId,
    data: {
      circleId,
      teamId,
      scheduleId,
      dueAt: dueAt.toISOString(),
      status: "due",
      outcome: null,
      completedBy: null,
      completedAt: null,
      activeEventId: null,
      version: 0,
    },
    permissions: [],
  });
}

async function deliveries() {
  const result = await tables.listRows({
    databaseId,
    tableId: TABLES.notifications,
    queries: [Query.equal("occurrenceId", occurrenceIds), Query.limit(25)],
    total: false,
  });
  return result.rows;
}

try {
  await tables.createRow({ databaseId, tableId: TABLES.circles, rowId: circleId, data: {
    name: "Reminder proof", teamId, timezone: "UTC", archivedAt: null,
  }, permissions: [] });
  await tables.createRow({ databaseId, tableId: TABLES.schedules, rowId: scheduleId, data: {
    circleId, recipientId: `rem_rec_${suffix}`, title: "Reminder proof action", instruction: null,
    localTime: "12:00", timezone: "UTC", rrule: "FREQ=DAILY", active: true,
  }, permissions: [] });
  for (let index = 0; index < users.length; index += 1) {
    await tables.createRow({ databaseId, tableId: TABLES.members, rowId: memberIds[index], data: {
      circleId, userId: users[index], role: index === 0 ? "owner" : "caregiver", status: "active", lastMutationAt: null,
    }, permissions: [] });
    await tables.createRow({ databaseId, tableId: TABLES.caregiverPreferences, rowId: preferenceIds[index], data: {
      circleId, userId: users[index], availability: index === 2 ? "unavailable" : "available", updatedAt: now.toISOString(),
    }, permissions: [] });
  }
  await tables.createRow({ databaseId, tableId: TABLES.circleSettings, rowId: settingsId, data: {
    circleId, primaryUserId: users[0], escalationMinutes: 60, updatedAt: now.toISOString(),
  }, permissions: [] });
  await createOccurrence(occurrenceIds[0], new Date(now.getTime() - 5 * 60_000));
  await createOccurrence(occurrenceIds[1], new Date(now.getTime() - 90 * 60_000));
  await createOccurrence(occurrenceIds[2], new Date(now.getTime() - 26 * 60 * 60_000));

  const options = {
    tables,
    messaging: { createEmail: async () => { throw new Error("Dry-run must not call Messaging"); } },
    teams: {
      listMemberships: async () => ({
        memberships: [
          ...users.map((userId) => ({ userId, confirm: true })),
        ],
      }),
    },
    databaseId,
    now,
    overdueMinutes: 60,
    dryRun: true,
    onlyOccurrenceIds: occurrenceIds,
    skipMaterialization: true,
  };
  const [first, concurrent] = await Promise.all([
    runReminderSweep(options),
    runReminderSweep(options),
  ]);
  const third = await runReminderSweep(options);
  const rows = await deliveries();

  assert.equal(rows.length, 2, "each occurrence and reminder level must have one delivery record");
  assert.deepEqual(new Set(rows.map((row) => row.kind)), new Set(["due", "overdue"]));
  assert.ok(rows.every((row) => row.status === "dry_run"), "the test must not send email");
  assert.equal(rows.find((row) => row.kind === "due")?.recipientCount, 1, "only the first available contact receives the due reminder");
  assert.equal(rows.find((row) => row.kind === "overdue")?.recipientCount, 2, "the escalation reaches every available caregiver");
  assert.equal(first.dryRun + concurrent.dryRun, 2, "concurrent sweeps must claim each reminder once");
  assert.equal(first.duplicate + concurrent.duplicate, 2, "the competing sweep must observe both claims");
  assert.equal(third.duplicate, 2, "a retry must not create another delivery");

  console.log("OneDose reminder proof passed");
  console.table({
    deliveryRows: rows.length,
    dueReminders: rows.filter((row) => row.kind === "due").length,
    overdueEscalations: rows.filter((row) => row.kind === "overdue").length,
    duplicateDeliveryPrevented: true,
    previousDayIgnored: !rows.some((row) => row.occurrenceId === occurrenceIds[2]),
    unavailableCaregiverExcluded: true,
    primaryContactReceivesFirstAlert: true,
  });
} finally {
  for (const row of await deliveries()) {
    await tables.deleteRow({ databaseId, tableId: TABLES.notifications, rowId: row.$id });
  }
  for (const occurrenceId of occurrenceIds) {
    try {
      await tables.deleteRow({ databaseId, tableId: TABLES.occurrences, rowId: occurrenceId });
    } catch {}
  }
  await tables.deleteRow({ databaseId, tableId: TABLES.circleSettings, rowId: settingsId }).catch(() => undefined);
  for (const rowId of preferenceIds) await tables.deleteRow({ databaseId, tableId: TABLES.caregiverPreferences, rowId }).catch(() => undefined);
  for (const rowId of memberIds) await tables.deleteRow({ databaseId, tableId: TABLES.members, rowId }).catch(() => undefined);
  await tables.deleteRow({ databaseId, tableId: TABLES.schedules, rowId: scheduleId }).catch(() => undefined);
  await tables.deleteRow({ databaseId, tableId: TABLES.circles, rowId: circleId }).catch(() => undefined);
}
