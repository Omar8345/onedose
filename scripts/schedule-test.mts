import assert from "node:assert/strict";

import nextEnv from "@next/env";
import { Query } from "node-appwrite";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const [
  { createSchedule, updateSchedule },
  { ensureTodayOccurrences },
  { getServerAppwrite },
  { TABLES },
] = await Promise.all([
  import("../src/lib/data/manage-schedule"),
  import("../src/lib/data/ensure-occurrences"),
  import("../src/lib/appwrite/server"),
  import("../src/lib/domain/schema"),
]);

const CIRCLE_ID = "demo_circle_nora";
const OWNER_ID = "demo_omar";
const { databaseId, tables } = getServerAppwrite();
let scheduleId: string | null = null;

async function scheduleOccurrences() {
  if (!scheduleId) return [];
  const result = await tables.listRows({
    databaseId,
    tableId: TABLES.occurrences,
    queries: [Query.equal("scheduleId", [scheduleId]), Query.limit(25)],
    total: false,
  });
  return result.rows;
}

try {
  const schedule = await createSchedule(CIRCLE_ID, OWNER_ID, {
    title: "Schedule test action",
    instruction: "Synthetic integration test",
    localTime: "09:15",
    active: true,
  });
  scheduleId = schedule.$id;

  await Promise.all([ensureTodayOccurrences(CIRCLE_ID), ensureTodayOccurrences(CIRCLE_ID)]);
  let occurrences = await scheduleOccurrences();
  assert.equal(occurrences.length, 1, "repeated generation must create one daily occurrence");
  const originalDueAt = occurrences[0].dueAt;

  await updateSchedule(CIRCLE_ID, scheduleId, OWNER_ID, {
    title: "Updated schedule test action",
    instruction: "Synthetic integration test",
    localTime: "10:45",
    active: true,
  });
  occurrences = await scheduleOccurrences();
  assert.equal(occurrences.length, 1, "editing must not duplicate today's occurrence");
  assert.notEqual(occurrences[0].dueAt, originalDueAt, "editing the time must move an unrecorded occurrence");

  await updateSchedule(CIRCLE_ID, scheduleId, OWNER_ID, {
    title: "Updated schedule test action",
    instruction: "Synthetic integration test",
    localTime: "10:45",
    active: false,
  });
  let stored = await tables.getRow({ databaseId, tableId: TABLES.schedules, rowId: scheduleId });
  assert.equal(stored.active, false, "pause must disable the schedule");

  await updateSchedule(CIRCLE_ID, scheduleId, OWNER_ID, {
    title: "Updated schedule test action",
    instruction: "Synthetic integration test",
    localTime: "10:45",
    active: true,
  });
  stored = await tables.getRow({ databaseId, tableId: TABLES.schedules, rowId: scheduleId });
  assert.equal(stored.active, true, "resume must reactivate the schedule");
  assert.equal((await scheduleOccurrences()).length, 1, "resume must reuse today's occurrence");

  console.log("OneDose daily schedule proof passed");
  console.table({
    generatedPerDay: 1,
    duplicateGenerationPrevented: true,
    editedWithoutDuplicate: true,
    pauseResumeVerified: true,
  });
} finally {
  if (scheduleId) {
    for (const occurrence of await scheduleOccurrences()) {
      await tables.deleteRow({ databaseId, tableId: TABLES.occurrences, rowId: occurrence.$id });
    }
    await tables.deleteRow({ databaseId, tableId: TABLES.schedules, rowId: scheduleId });
  }
}
