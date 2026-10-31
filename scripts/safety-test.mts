import assert from "node:assert/strict";

import nextEnv from "@next/env";
import { Query, type Models } from "node-appwrite";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const [
  { CompletionForbiddenError, CompletionInputConflictError, completeOccurrence },
  { claimOccurrence },
  { getServerAppwrite },
  { TABLES },
] = await Promise.all([
  import("../src/lib/data/complete-occurrence"),
  import("../src/lib/data/manage-occurrence-claim"),
  import("../src/lib/appwrite/server"),
  import("../src/lib/domain/schema"),
]);

const { databaseId, tables, users } = getServerAppwrite();
const runId = Date.now().toString(36);
const occurrenceId = `safe_occ_${runId}`;
const dueAt = new Date().toISOString();
let createdOccurrence = false;
let sessionId: string | undefined;
let createdUser = false;

async function relatedRows(tableId: string) {
  return tables.listRows({
    databaseId,
    tableId,
    queries: [Query.equal("occurrenceId", [occurrenceId]), Query.limit(25)],
    total: false,
  });
}

async function removeRows(tableId: string, rows: Models.Row[]) {
  for (const row of rows) await tables.deleteRow({ databaseId, tableId, rowId: row.$id });
}

try {
  await tables.createRow({
    databaseId,
    tableId: TABLES.occurrences,
    rowId: occurrenceId,
    data: {
      circleId: "demo_circle_nora",
      teamId: "demo_team",
      scheduleId: "demo_schedule_midday",
      dueAt,
      status: "due",
      version: 0,
    },
    permissions: [],
  });
  createdOccurrence = true;

  await assert.rejects(
    completeOccurrence({
      occurrenceId,
      actorId: `intruder_${runId}`,
      idempotencyKey: `unauthorized-${runId}-request`,
      outcome: "completed",
      occurredAt: dueAt,
    }),
    CompletionForbiddenError,
    "a user outside the circle must not complete an occurrence",
  );

  const input = {
    occurrenceId,
    actorId: "demo_omar",
    idempotencyKey: `retry-${runId}-request`,
    outcome: "completed" as const,
    note: "Safety proof",
    occurredAt: dueAt,
  };
  const claim = await claimOccurrence(occurrenceId, input.actorId);
  assert.equal(claim.kind, "claimed", "the authorized caregiver must claim the action first");
  try {
    await users.get({ userId: input.actorId });
  } catch (error) {
    if ((error as { code?: number }).code !== 404) throw error;
    await users.create({ userId: input.actorId, email: `safety-${runId}@example.invalid`, name: "Synthetic safety caregiver" });
    createdUser = true;
  }
  const session = await users.createSession({ userId: input.actorId });
  sessionId = session.$id;
  const post = async (body: Record<string, unknown>) => {
    const response = await fetch(`${process.env.TEST_BASE_URL ?? "http://127.0.0.1:3000"}/api/occurrences/${occurrenceId}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: `onedose_session=${session.secret}` },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  const body = { idempotencyKey: input.idempotencyKey, outcome: input.outcome, note: input.note };
  const first = await post(body);
  assert.equal(first.status, 200);
  await new Promise((resolve) => setTimeout(resolve, 30));
  const retry = await post(body);
  assert.equal(retry.status, 200, "identical HTTP retry must replay despite a new server timestamp");
  assert.equal(retry.body.kind, "replayed");
  assert.deepEqual(retry.body.occurrence, first.body.occurrence);
  for (const changed of [{ note: "Changed note" }, { outcome: "skipped" }, { correctsEventId: "different-event" }]) {
    assert.equal((await post({ ...body, ...changed })).status, 409);
  }
  console.log("HTTP retry regression passed: identical retry replays; changed note, outcome, correction conflict");
  const accepted = { kind: "accepted" as const, eventId: first.body.occurrence.activeEventId };
  const replayed = await completeOccurrence(input);
  await assert.rejects(
    completeOccurrence({ ...input, note: "Changed after retry" }),
    CompletionInputConflictError,
    "the same key with different input must be rejected",
  );

  assert.equal(accepted.kind, "accepted");
  if (accepted.kind !== "accepted") throw new Error("The initial outcome was not accepted.");

  const correctionInputs = Array.from({ length: 25 }, (_, index) => ({
    occurrenceId,
    actorId: index % 2 === 0 ? "demo_omar" : "demo_maya",
    idempotencyKey: `correction-${runId}-${index.toString().padStart(2, "0")}`,
    outcome: (index % 2 === 0 ? "skipped" : "unavailable") as "skipped" | "unavailable",
    note: `Concurrent correction ${index + 1}`,
    occurredAt: new Date(Date.now() + 1_000).toISOString(),
    correctsEventId: accepted.eventId,
  }));
  const correctionResults = await Promise.all(correctionInputs.map((value) => completeOccurrence(value)));
  const correctedIndex = correctionResults.findIndex((result) => result.kind === "corrected");
  assert.notEqual(correctedIndex, -1, "one correction must be accepted");
  assert.equal(correctionResults.filter((result) => result.kind === "corrected").length, 1);
  assert.equal(correctionResults.filter((result) => result.kind === "already_recorded").length, 24);

  const corrected = correctionResults[correctedIndex];
  if (corrected.kind !== "corrected") throw new Error("The correction winner was not found.");
  const replayedCorrection = await completeOccurrence(correctionInputs[correctedIndex]);
  assert.equal(replayedCorrection.kind, "replayed", "the winning correction must be safely replayable");

  const staleCorrection = await completeOccurrence({
    ...correctionInputs[0],
    idempotencyKey: `stale-correction-${runId}`,
  });
  assert.equal(staleCorrection.kind, "already_recorded", "a stale screen must not overwrite the winning correction");

  const [occurrence, events, commands] = await Promise.all([
    tables.getRow({ databaseId, tableId: TABLES.occurrences, rowId: occurrenceId }),
    relatedRows(TABLES.events),
    relatedRows(TABLES.commands),
  ]);
  assert.equal(replayed.kind, "replayed");
  assert.equal(occurrence.version, 3);
  assert.equal(occurrence.activeEventId, corrected.eventId);
  assert.equal(events.rows.length, 2);
  assert.equal(commands.rows.length, 2);
  const correctionEvent = events.rows.find((event) => event.$id === corrected.eventId);
  assert.equal(correctionEvent?.type, "outcome_corrected");
  assert.equal(correctionEvent?.supersedesEventId, accepted.eventId);

  console.log("OneDose access and retry proof passed");
  console.table({
    unauthorizedAttemptRejected: true,
    firstAttempt: accepted.kind,
    identicalRetry: replayed.kind,
    changedRetryRejected: true,
    concurrentCorrections: correctionResults.length,
    acceptedCorrections: 1,
    staleCorrectionRejected: true,
    auditEvents: events.rows.length,
    commandReceipts: commands.rows.length,
    finalVersion: occurrence.version,
  });
} finally {
  if (sessionId) await users.deleteSession({ userId: "demo_omar", sessionId });
  if (createdUser) await users.delete({ userId: "demo_omar" });
  if (createdOccurrence) {
    const [events, commands] = await Promise.all([
      relatedRows(TABLES.events),
      relatedRows(TABLES.commands),
    ]);
    await removeRows(TABLES.commands, commands.rows);
    await removeRows(TABLES.events, events.rows);
    await tables.deleteRow({ databaseId, tableId: TABLES.occurrences, rowId: occurrenceId });
  }
}
