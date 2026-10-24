import assert from "node:assert/strict";

import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const [
  { archiveRecipient, createRecipient, updateRecipient },
  { archiveSchedule, createSchedule },
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
let recipientId: string | null = null;
let scheduleId: string | null = null;

try {
  const recipient = await createRecipient(CIRCLE_ID, OWNER_ID, {
    displayName: "Recipient proof",
    relationship: "Synthetic test",
    careNotes: "No private information.",
    timezone: "UTC",
  });
  recipientId = recipient.$id;

  await updateRecipient(CIRCLE_ID, recipientId, OWNER_ID, {
    displayName: "Updated recipient proof",
    relationship: "Synthetic test",
    careNotes: "Updated context.",
    timezone: "Asia/Dubai",
  });
  const updated = await tables.getRow({ databaseId, tableId: TABLES.recipients, rowId: recipientId });
  assert.equal(updated.displayName, "Updated recipient proof");
  assert.equal(updated.timezone, "Asia/Dubai");

  await assert.rejects(
    createRecipient(CIRCLE_ID, "demo_maya", { displayName: "Denied", timezone: "UTC" }),
    (error: unknown) => error instanceof Error && error.name === "RecipientForbiddenError",
  );

  const schedule = await createSchedule(CIRCLE_ID, OWNER_ID, {
    recipientId,
    title: "Recipient assignment proof",
    instruction: "Synthetic integration test",
    localTime: "09:15",
    active: false,
  });
  scheduleId = schedule.$id;
  assert.equal(schedule.recipientId, recipientId);
  assert.equal(schedule.timezone, "Asia/Dubai");

  await assert.rejects(
    archiveRecipient(CIRCLE_ID, recipientId, OWNER_ID),
    (error: unknown) => error instanceof Error && error.name === "RecipientInUseError",
  );

  await archiveSchedule(CIRCLE_ID, scheduleId, OWNER_ID);
  await archiveRecipient(CIRCLE_ID, recipientId, OWNER_ID);
  const archived = await tables.getRow({ databaseId, tableId: TABLES.recipients, rowId: recipientId });
  assert.ok(archived.archivedAt);

  console.log("OneDose care recipient proof passed");
  console.table({ ownerOnly: true, profileUpdate: true, explicitScheduleAssignment: true, inUseProtection: true, softArchive: true });
} finally {
  if (scheduleId) await tables.deleteRow({ databaseId, tableId: TABLES.schedules, rowId: scheduleId }).catch(() => undefined);
  if (recipientId) await tables.deleteRow({ databaseId, tableId: TABLES.recipients, rowId: recipientId }).catch(() => undefined);
}
