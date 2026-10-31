import assert from "node:assert/strict";

import nextEnv from "@next/env";
import { Query } from "node-appwrite";

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


const runId = Date.now().toString(36);
const actorId = `safe_actor_${runId}`;
const teamId = `safe_team_${runId}`;
const circleId = `safe_circle_${runId}`;
const { stableRowId } = await import("../src/lib/domain/ids");
const memberId = stableRowId("mem", `${circleId}:${actorId}`);
const createdRows: Array<{ tableId: string; rowId: string }> = [];
let createdTeam = false;
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


const required = ["NEXT_PUBLIC_APPWRITE_ENDPOINT", "NEXT_PUBLIC_APPWRITE_PROJECT_ID", "NEXT_PUBLIC_APPWRITE_DATABASE_ID", "APPWRITE_API_KEY"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) throw new Error(`Safety test missing configuration: ${missing.join(", ")}`);
const { databaseId, tables, teams, users } = getServerAppwrite();
const baseUrl = new URL(process.env.TEST_BASE_URL ?? "http://127.0.0.1:3000");
try {
  const response = await fetch(new URL("/api/occurrences/safety-preflight/complete", baseUrl), {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idempotencyKey: "safety-preflight-request", outcome: "completed" }),
    signal: AbortSignal.timeout(15000), redirect: "error",
  });
  assert.equal(response.status, 401, "expected OneDose's unauthenticated completion route to return 401");
} catch {
  throw new Error(`Safety test requires a running OneDose server at ${baseUrl.origin} with matching Appwrite configuration (start npm run dev).`);
}
try {
  await users.create({ userId: actorId, email: `${actorId}@example.invalid`, name: "Synthetic safety caregiver" });
  createdUser = true;
  await teams.create({ teamId, name: "Safety test", roles: ["caregiver"] });
  createdTeam = true;
  await teams.createMembership({ teamId, membershipId: `safe_mem_${runId}`, userId: actorId, roles: ["caregiver"] });
  for (const row of [
    { tableId: TABLES.circles, rowId: circleId, data: { name: "Safety test", teamId, timezone: "UTC", archivedAt: null } },
    { tableId: TABLES.members, rowId: memberId, data: { circleId, userId: actorId, role: "caregiver", status: "active", lastMutationAt: null } },
  ]) {
    await tables.createRow({ databaseId, ...row, permissions: [] });
    createdRows.push(row);
  }
  await tables.createRow({
    databaseId,
    tableId: TABLES.occurrences,
    rowId: occurrenceId,
    data: {
      circleId,
      teamId,
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
    actorId,
    idempotencyKey: `retry-${runId}-request`,
    outcome: "completed" as const,
    note: "Safety proof",
    occurredAt: dueAt,
  };
  const claim = await claimOccurrence(occurrenceId, input.actorId);
  assert.equal(claim.kind, "claimed", "the authorized caregiver must claim the action first");
  const session = await users.createSession({ userId: input.actorId });
  sessionId = session.$id;
  const post = async (body: Record<string, unknown>) => {
    const response = await fetch(`${process.env.TEST_BASE_URL ?? "http://127.0.0.1:3000"}/api/occurrences/${occurrenceId}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: `onedose_session=${session.secret}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000), redirect: "error",
    });
    try {
      return { status: response.status, body: await response.json() };
    } catch { throw new Error(`Completion endpoint returned non-JSON (HTTP ${response.status}); check the server and TEST_BASE_URL.`); }
  };
  const body = { idempotencyKey: input.idempotencyKey, outcome: input.outcome, note: input.note };
  const first = await post(body);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.kind, "accepted");
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
    actorId,
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

  await tables.updateRow({ databaseId, tableId: TABLES.members, rowId: memberId, data: { status: "revoked" } });
  await teams.deleteMembership({ teamId, membershipId: `safe_mem_${runId}` });
  await assert.rejects(completeOccurrence(input), CompletionForbiddenError);
  for (const retryBody of [body, { ...body, note: "Changed after revocation" }]) {
    const revoked = await post(retryBody);
    assert.equal(revoked.status, 403, "revoked replay must not expose receipt details");
    assert.equal(revoked.body.occurrence, undefined);
    assert.equal(revoked.body.kind, undefined);
  }
  console.log("Revoked caregiver replay denied, including changed-input retry");
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
  const failures: unknown[] = [];
  const cleanup = async (action: () => Promise<unknown>) => {
    try { await action(); } catch (error) {
      if ((error as { code?: number }).code !== 404) failures.push(error);
    }
  };
  if (sessionId) await cleanup(() => users.deleteSession({ userId: actorId, sessionId: sessionId! }));
  if (createdOccurrence) {
    for (const tableId of [TABLES.commands, TABLES.events, TABLES.claims]) {
      await cleanup(async () => {
        const rows = await relatedRows(tableId);
        for (const row of rows.rows) await cleanup(() => tables.deleteRow({ databaseId, tableId, rowId: row.$id }));
      });
    }
    await cleanup(() => tables.deleteRow({ databaseId, tableId: TABLES.occurrences, rowId: occurrenceId }));
  }
  for (const row of createdRows.reverse()) await cleanup(() => tables.deleteRow({ databaseId, ...row }));
  if (createdTeam) await cleanup(() => teams.delete({ teamId }));
  if (createdUser) await cleanup(() => users.delete({ userId: actorId }));
  if (failures.length) throw new AggregateError(failures, "Safety test cleanup failed; inspect synthetic resources for this run.");
}
