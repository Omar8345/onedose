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
const occurrenceIds = [`rem_due_${suffix}`, `rem_late_${suffix}`];
const scheduleId = "demo_schedule_midday";
const circleId = "demo_circle_nora";

async function createOccurrence(rowId: string, dueAt: Date) {
  await tables.createRow({
    databaseId,
    tableId: TABLES.occurrences,
    rowId,
    data: {
      circleId,
      teamId: "demo_team",
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
  await createOccurrence(occurrenceIds[0], new Date(now.getTime() - 5 * 60_000));
  await createOccurrence(occurrenceIds[1], new Date(now.getTime() - 90 * 60_000));

  const options = {
    tables,
    messaging: { createEmail: async () => { throw new Error("Dry-run must not call Messaging"); } },
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
  assert.equal(first.dryRun + concurrent.dryRun, 2, "concurrent sweeps must claim each reminder once");
  assert.equal(first.duplicate + concurrent.duplicate, 2, "the competing sweep must observe both claims");
  assert.equal(third.duplicate, 2, "a retry must not create another delivery");

  console.log("OneDose reminder proof passed");
  console.table({
    deliveryRows: rows.length,
    dueReminders: rows.filter((row) => row.kind === "due").length,
    overdueEscalations: rows.filter((row) => row.kind === "overdue").length,
    duplicateDeliveryPrevented: true,
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
}
