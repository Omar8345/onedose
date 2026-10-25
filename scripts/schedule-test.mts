import assert from "node:assert/strict";

import nextEnv from "@next/env";
import { Query } from "node-appwrite";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const [
  { archiveSchedule, createSchedule, updateSchedule },
  { ensureTodayOccurrences },
  { getServerAppwrite },
  { TABLES },
  { WEEKDAYS, weekdayCode },
  { localDateKey },
] = await Promise.all([
  import("../src/lib/data/manage-schedule"),
  import("../src/lib/data/ensure-occurrences"),
  import("../src/lib/appwrite/server"),
  import("../src/lib/domain/schema"),
  import("../src/lib/domain/recurrence"),
  import("../src/lib/domain/time"),
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

  let stored = await tables.getRow({ databaseId, tableId: TABLES.schedules, rowId: scheduleId });
  const todayCode = weekdayCode(new Date(), stored.timezone);
  const otherDay = WEEKDAYS.find((day) => day.code !== todayCode)?.code ?? "MO";
  await updateSchedule(CIRCLE_ID, scheduleId, OWNER_ID, {
    title: "Updated schedule test action",
    instruction: "Synthetic integration test",
    localTime: "10:45",
    frequency: "weekly",
    weekdays: [otherDay],
    active: true,
  });
  assert.equal((await scheduleOccurrences()).length, 0, "a weekday rule must remove an unrecorded occurrence when today is excluded");

  await updateSchedule(CIRCLE_ID, scheduleId, OWNER_ID, {
    title: "Updated schedule test action",
    instruction: "Synthetic integration test",
    localTime: "10:45",
    frequency: "weekly",
    weekdays: [todayCode],
    active: true,
  });
  assert.equal((await scheduleOccurrences()).length, 1, "a weekday rule must generate today's selected occurrence");

  const tomorrowKey = localDateKey(new Date(Date.now() + 24 * 60 * 60_000), stored.timezone);
  await updateSchedule(CIRCLE_ID, scheduleId, OWNER_ID, {
    title: "Updated schedule test action",
    instruction: "Synthetic integration test",
    localTime: "10:45",
    frequency: "once",
    date: tomorrowKey,
    active: true,
  });
  assert.equal((await scheduleOccurrences()).length, 0, "a future one-time action must not generate today");

  await updateSchedule(CIRCLE_ID, scheduleId, OWNER_ID, {
    title: "Updated schedule test action",
    instruction: "Synthetic integration test",
    localTime: "10:45",
    frequency: "once",
    date: localDateKey(new Date(), stored.timezone),
    active: true,
  });
  assert.equal((await scheduleOccurrences()).length, 1, "a one-time action must generate on its selected local date");

  await updateSchedule(CIRCLE_ID, scheduleId, OWNER_ID, {
    title: "Updated schedule test action",
    instruction: "Synthetic integration test",
    localTime: "10:45",
    active: false,
  });
  stored = await tables.getRow({ databaseId, tableId: TABLES.schedules, rowId: scheduleId });
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

  await assert.rejects(
    archiveSchedule(CIRCLE_ID, scheduleId, "demo_maya"),
    (error: unknown) => error instanceof Error && error.name === "ScheduleForbiddenError",
    "a caregiver must not be able to remove a daily action",
  );
  await archiveSchedule(CIRCLE_ID, scheduleId, OWNER_ID);
  stored = await tables.getRow({ databaseId, tableId: TABLES.schedules, rowId: scheduleId });
  assert.equal(stored.active, false, "removal must disable future generation");
  assert.ok(stored.archivedAt, "removal must retain a soft archive marker");
  assert.equal((await scheduleOccurrences()).length, 1, "removal must preserve occurrence history");
  await ensureTodayOccurrences(CIRCLE_ID);
  assert.equal((await scheduleOccurrences()).length, 1, "archived schedules must not generate occurrences");

  console.log("OneDose daily schedule proof passed");
  console.table({
    generatedPerDay: 1,
    duplicateGenerationPrevented: true,
    editedWithoutDuplicate: true,
    pauseResumeVerified: true,
    selectedWeekdaysVerified: true,
    oneTimeDateVerified: true,
    ownerOnlyRemovalVerified: true,
    historyPreservedAfterRemoval: true,
  });
} finally {
  if (scheduleId) {
    for (const occurrence of await scheduleOccurrences()) {
      await tables.deleteRow({ databaseId, tableId: TABLES.occurrences, rowId: occurrence.$id });
    }
    await tables.deleteRow({ databaseId, tableId: TABLES.schedules, rowId: scheduleId });
  }
}
