import assert from "node:assert/strict";

import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const [
  { archiveRecipient, createRecipient, updateRecipient },
  { archiveSchedule, createSchedules },
  { getServerAppwrite },
  { TABLES },
] = await Promise.all([
  import("../src/lib/data/manage-recipient"),
  import("../src/lib/data/manage-schedule"),
  import("../src/lib/appwrite/server"),
  import("../src/lib/domain/schema"),
]);

const CIRCLE_ID = "demo_circle_nora";
const OWNER_ID = "demo_omar";
const { databaseId, tables } = getServerAppwrite();
const recipientIds: string[] = [];
const scheduleIds: string[] = [];

try {
  const recipient = await createRecipient(CIRCLE_ID, OWNER_ID, {
    displayName: "Recipient proof",
    relationship: "Synthetic test",
    careNotes: "No private information.",
    timezone: "UTC",
  });
  recipientIds.push(recipient.$id);

  await updateRecipient(CIRCLE_ID, recipient.$id, OWNER_ID, {
    displayName: "Updated recipient proof",
    relationship: "Synthetic test",
    careNotes: "Updated context.",
    timezone: "Asia/Dubai",
  });
  const updated = await tables.getRow({ databaseId, tableId: TABLES.recipients, rowId: recipient.$id });
  assert.equal(updated.displayName, "Updated recipient proof");
  assert.equal(updated.timezone, "Asia/Dubai");

  await assert.rejects(
    createRecipient(CIRCLE_ID, "demo_maya", { displayName: "Denied", timezone: "UTC" }),
    (error: unknown) => error instanceof Error && error.name === "RecipientForbiddenError",
  );

  const secondRecipient = await createRecipient(CIRCLE_ID, OWNER_ID, {
    displayName: "Second recipient proof",
    relationship: "Synthetic test",
    careNotes: "No private information.",
    timezone: "UTC",
  });
  recipientIds.push(secondRecipient.$id);

  const schedules = await createSchedules(CIRCLE_ID, OWNER_ID, {
    recipientIds,
    title: "Recipient assignment proof",
    instruction: "Synthetic integration test",
    localTime: "09:15",
    active: false,
  });
  scheduleIds.push(...schedules.map((schedule) => schedule.$id));
  assert.equal(schedules.length, 2);
  assert.deepEqual(new Set(schedules.map((schedule) => schedule.recipientId)), new Set(recipientIds));
  assert.equal(schedules.find((schedule) => schedule.recipientId === recipient.$id)?.timezone, "Asia/Dubai");
  assert.equal(schedules.find((schedule) => schedule.recipientId === secondRecipient.$id)?.timezone, "UTC");

  await assert.rejects(
    archiveRecipient(CIRCLE_ID, recipient.$id, OWNER_ID),
    (error: unknown) => error instanceof Error && error.name === "RecipientInUseError",
  );

  await Promise.all(scheduleIds.map((scheduleId) => archiveSchedule(CIRCLE_ID, scheduleId, OWNER_ID)));
  await Promise.all(recipientIds.map((recipientId) => archiveRecipient(CIRCLE_ID, recipientId, OWNER_ID)));
  const archived = await tables.getRow({ databaseId, tableId: TABLES.recipients, rowId: recipient.$id });
  assert.ok(archived.archivedAt);

  console.log("OneDose care recipient proof passed");
  console.table({ ownerOnly: true, profileUpdate: true, bulkScheduleAssignment: true, independentSchedules: true, inUseProtection: true, softArchive: true });
} finally {
  for (const scheduleId of scheduleIds) {
    await tables.deleteRow({ databaseId, tableId: TABLES.schedules, rowId: scheduleId }).catch(() => undefined);
  }
  for (const recipientId of recipientIds) {
    await tables.deleteRow({ databaseId, tableId: TABLES.recipients, rowId: recipientId }).catch(() => undefined);
  }
}
