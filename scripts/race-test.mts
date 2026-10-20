import assert from "node:assert/strict";

import nextEnv from "@next/env";
import { Query, type Models } from "node-appwrite";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const [{ completeOccurrence }, { getCareCircle }, { getServerAppwrite }, { TABLES }] = await Promise.all([
  import("../src/lib/data/complete-occurrence"),
  import("../src/lib/data/get-care-circle"),
  import("../src/lib/appwrite/server"),
  import("../src/lib/domain/schema"),
]);

const REQUEST_COUNT = 25;
const CIRCLE_ID = "demo_circle_nora";
const TEAM_ID = "demo_team";
const SCHEDULE_ID = "demo_schedule_midday";
const ACTORS = ["demo_omar", "demo_maya"] as const;

const { databaseId, tables } = getServerAppwrite();
const runId = Date.now().toString(36);
const occurrenceId = `race_occ_${runId}`;
const dueAt = new Date().toISOString();
let createdOccurrence = false;

async function rowsFor(tableId: string) {
  return tables.listRows({
    databaseId,
    tableId,
    queries: [Query.equal("occurrenceId", [occurrenceId]), Query.limit(100)],
    total: false,
  });
}

async function removeRows(tableId: string, rows: Models.Row[]) {
  for (const row of rows) {
    await tables.deleteRow({ databaseId, tableId, rowId: row.$id });
  }
}

async function cleanup() {
  if (!createdOccurrence || process.env.KEEP_RACE_DATA === "1") return;

  const [events, commands] = await Promise.all([
    rowsFor(TABLES.events),
    rowsFor(TABLES.commands),
  ]);
  await removeRows(TABLES.commands, commands.rows);
  await removeRows(TABLES.events, events.rows);
  await tables.deleteRow({ databaseId, tableId: TABLES.occurrences, rowId: occurrenceId });
}

try {
  await tables.createRow({
    databaseId,
    tableId: TABLES.occurrences,
    rowId: occurrenceId,
    data: {
      circleId: CIRCLE_ID,
      teamId: TEAM_ID,
      scheduleId: SCHEDULE_ID,
      dueAt,
      status: "due",
      version: 0,
    },
    permissions: [],
  });
  createdOccurrence = true;

  const [omarBefore, mayaBefore] = await Promise.all([
    getCareCircle(CIRCLE_ID, { id: ACTORS[0], name: "Omar" }),
    getCareCircle(CIRCLE_ID, { id: ACTORS[1], name: "Maya" }),
  ]);
  const omarOccurrence = omarBefore.occurrences.find((item) => item.id === occurrenceId);
  const mayaOccurrence = mayaBefore.occurrences.find((item) => item.id === occurrenceId);
  assert.equal(omarOccurrence?.status, "due", "the owner must see the shared occurrence as due");
  assert.equal(mayaOccurrence?.status, "due", "the caregiver must see the same occurrence as due");

  console.log(`Two caregivers see ${occurrenceId}. Launching ${REQUEST_COUNT} simultaneous completion requests...`);
  const startedAt = performance.now();
  const results = await Promise.all(
    Array.from({ length: REQUEST_COUNT }, (_, index) =>
      completeOccurrence({
        occurrenceId,
        actorId: ACTORS[index % ACTORS.length],
        idempotencyKey: `race-${runId}-${String(index).padStart(2, "0")}-request`,
        outcome: "completed",
        note: `Concurrent request ${index + 1}`,
        occurredAt: dueAt,
      }),
    ),
  );
  const elapsedMs = Math.round(performance.now() - startedAt);

  const accepted = results.filter((result) => result.kind === "accepted");
  const replayed = results.filter((result) => result.kind === "replayed");
  const conflicts = results.filter((result) => result.kind === "already_recorded");
  const [occurrence, events, commands, omarAfter, mayaAfter] = await Promise.all([
    tables.getRow({ databaseId, tableId: TABLES.occurrences, rowId: occurrenceId }),
    rowsFor(TABLES.events),
    rowsFor(TABLES.commands),
    getCareCircle(CIRCLE_ID, { id: ACTORS[0], name: "Omar" }),
    getCareCircle(CIRCLE_ID, { id: ACTORS[1], name: "Maya" }),
  ]);

  assert.equal(accepted.length, 1, "exactly one request must be accepted");
  assert.equal(replayed.length, 0, "unique idempotency keys must not replay");
  assert.equal(conflicts.length, REQUEST_COUNT - 1, "every other request must observe the winner");
  assert.equal(occurrence.status, "completed", "the occurrence must be completed");
  assert.equal(occurrence.version, 1, "the contested row must be updated once");
  assert.equal(events.rows.length, 1, "exactly one audit event must exist");
  assert.equal(commands.rows.length, 1, "exactly one command receipt must exist");
  assert.equal(events.rows[0].$id, occurrence.activeEventId, "the occurrence must point to its audit event");
  assert.equal(
    omarAfter.occurrences.find((item) => item.id === occurrenceId)?.status,
    "completed",
    "the owner's refreshed view must converge on the winner",
  );
  assert.equal(
    mayaAfter.occurrences.find((item) => item.id === occurrenceId)?.status,
    "completed",
    "the caregiver's refreshed view must converge on the winner",
  );

  console.log("\nOneDose concurrency proof passed");
  console.table({
    requests: REQUEST_COUNT,
    caregiverViews: 2,
    accepted: accepted.length,
    conflicts: conflicts.length,
    auditEvents: events.rows.length,
    commandReceipts: commands.rows.length,
    finalVersion: occurrence.version,
    winner: occurrence.completedBy,
    converged: true,
    elapsedMs,
  });
} finally {
  await cleanup();
}
