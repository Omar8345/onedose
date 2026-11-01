import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import nextEnv from "@next/env";
import { Query, TablesDB } from "node-appwrite";
import type { OccurrenceRow } from "../src/lib/domain/schema";

nextEnv.loadEnvConfig(process.cwd());
const [{ integrationFixture }, { claimOccurrence, releaseOccurrenceClaim, getOccurrenceClaimState },
  { completeOccurrence, CompletionClaimRequiredError, CompletionClaimedByAnotherError }, { getServerAppwrite }, { stableRowId }, { TABLES }] = await Promise.all([
  import("./integration-fixture"), import("../src/lib/data/manage-occurrence-claim"),
  import("../src/lib/data/complete-occurrence"), import("../src/lib/appwrite/server"),
  import("../src/lib/domain/ids"), import("../src/lib/domain/schema"),
]);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
function barrier(count: number) {
  let arrived = 0;
  let open!: () => void;
  const gate = new Promise<void>((resolve) => { open = resolve; });
  return async () => {
    if (++arrived === count) open();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([gate, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Race barrier timed out")), 15_000);
      })]);
    } finally { clearTimeout(timer); }
  };
}

type Trace = { reads: number; commits: number; readGate?: () => Promise<void>; readDelay?: number; commitGate?: () => Promise<void> };
const context = new AsyncLocalStorage<Trace>();
// tsx domain imports and this ESM runner can use different SDK exports. Patch
// both in this process only; no application server or network response is mocked.
const cjs = createRequire(import.meta.url)("node-appwrite") as { TablesDB: typeof TablesDB };
const originals = [...new Set([TablesDB.prototype, cjs.TablesDB.prototype])].map((prototype) => ({
  prototype, getRow: prototype.getRow, updateTransaction: prototype.updateTransaction,
}));
for (const { prototype, getRow, updateTransaction } of originals) {
  prototype.getRow = (async function (this: TablesDB, ...args: unknown[]) {
    const row = await Reflect.apply(getRow, this, args);
    const params = args[0] as { transactionId?: string; tableId?: string };
    const trace = context.getStore();
    if (trace && params.transactionId && params.tableId === TABLES.claims) {
      trace.reads++;
      await trace.readGate?.();
      if (trace.readDelay) await sleep(trace.readDelay);
    }
    return row;
  }) as typeof prototype.getRow;
  prototype.updateTransaction = (async function (this: TablesDB, ...args: unknown[]) {
    const trace = context.getStore();
    if ((args[0] as { commit?: boolean }).commit && trace) {
      await trace.commitGate?.();
      const result = await Reflect.apply(updateTransaction, this, args);
      trace.commits++;
      return result;
    }
    return Reflect.apply(updateTransaction, this, args);
  }) as typeof prototype.updateTransaction;
}

const fixture = await integrationFixture("schedule");
const { circleId, ownerId, caregiverId, recipientId, databaseId, tables } = fixture;
const { users, teams } = getServerAppwrite();
const run = randomBytes(6).toString("hex");
const transitionsOnly = process.argv.includes("--transitions-only");
const extraUsers: string[] = [], extraMembers: string[] = [], occurrenceIds: string[] = [];
const scheduleId = `fence_sched_${run}`;
const rows = async (tableId: string, occurrenceId: string) => {
  assert.ok(occurrenceIds.includes(occurrenceId));
  const found = await tables.listRows({ databaseId, tableId, queries: [Query.equal("occurrenceId", [occurrenceId]), Query.limit(100)], total: false });
  assert.ok(found.rows.length < 100, "Unexpected fixture size; do not broaden cleanup");
  return found.rows;
};
const occurrence = (rowId: string) => tables.getRow<OccurrenceRow>({ databaseId, tableId: TABLES.occurrences, rowId });
let sequence = 0;
const completion = (id: string, actorId: string) => completeOccurrence({
  occurrenceId: id, actorId, idempotencyKey: `fence-${run}-${++sequence}-request`, outcome: "completed", occurredAt: new Date().toISOString(),
});
async function drain<T>(operations: Promise<T>[]) {
  const results = await Promise.allSettled(operations);
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length) throw new AggregateError(failures.map((result) => result.reason), "Race requests failed; all contenders drained before cleanup");
  return results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
}
const settled = async <T,>(operation: Promise<T>) => operation.then((value) => ({ value, error: undefined }), (error: unknown) => ({ value: undefined, error }));
async function expire(id: string) {
  const expiresAt = new Date(Date.now() - 60_000).toISOString();
  await tables.updateRow({ databaseId, tableId: TABLES.claims, rowId: stableRowId("clm", id), data: { expiresAt } });
  await tables.updateRow({ databaseId, tableId: TABLES.occurrences, rowId: id, data: { claimExpiresAt: expiresAt } });
}
async function newOccurrence(claim = true) {
  const id = `fence_occ_${run}_${occurrenceIds.length}`;
  const circle = await tables.getRow({ databaseId, tableId: TABLES.circles, rowId: circleId });
  await tables.createRow({ databaseId, tableId: TABLES.occurrences, rowId: id, data: {
    circleId, teamId: circle.teamId, scheduleId, dueAt: new Date(Date.now() - 60_000).toISOString(), status: "due", version: 0,
  }, permissions: [] });
  occurrenceIds.push(id);
  if (claim) assert.equal((await claimOccurrence(id, ownerId)).kind, "claimed");
  return id;
}
async function eventCounts(id: string, expected: number) {
  assert.equal((await rows(TABLES.events, id)).length, expected);
  assert.equal((await rows(TABLES.commands, id)).length, expected);
}
// Pause a real completion/release after it reads its lease, commit an intervening
// transition, then resume. Always drain the paused operation before cleanup.
async function staleRace(mode: "takeover" | "release" | "release-reclaim" | "completion-before-release") {
  const id = await newOccurrence();
  let resume!: () => void, read!: () => void;
  const paused = new Promise<void>((resolve) => { resume = resolve; });
  const ready = new Promise<void>((resolve) => { read = resolve; });
  const trace: Trace = { reads: 0, commits: 0, readGate: async () => { read(); await paused; } };
  const pending = settled<Awaited<ReturnType<typeof releaseOccurrenceClaim>> | Awaited<ReturnType<typeof completeOccurrence>>>(context.run(trace, () => mode === "completion-before-release"
    ? releaseOccurrenceClaim(id, ownerId) : completion(id, ownerId)));
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([ready, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Lease read hook missing")), 15_000); })]); }
    finally { clearTimeout(timer); }
    if (mode === "takeover") {
      await expire(id);
      assert.equal((await claimOccurrence(id, caregiverId)).kind, "claimed");
    } else if (mode === "completion-before-release") {
      assert.equal((await completion(id, ownerId)).kind, "accepted");
    } else {
      assert.equal((await releaseOccurrenceClaim(id, ownerId)).kind, "released");
      if (mode === "release-reclaim") assert.equal((await claimOccurrence(id, ownerId)).kind, "claimed");
    }
  } finally { resume(); await pending; }
  const result = await pending;
  assert.equal(trace.reads, 1);
  assert.equal(trace.commits, 0, "The stale transaction itself must not commit");
  if (mode === "completion-before-release") {
    assert.equal(result.error, undefined);
    assert.equal(result.value?.kind, "already_recorded");
    await eventCounts(id, 1);
  } else {
    assert.ok(result.error instanceof CompletionClaimRequiredError);
    assert.equal((await occurrence(id)).status, "due");
    await eventCounts(id, 0);
    if (mode !== "release") assert.equal((await completion(id, mode === "takeover" ? caregiverId : ownerId)).kind, "accepted");
  }
  console.log(`PASS stale ${mode}: zero stale commits`);
}


async function takeoverAfterCompletion() {
  const id = await newOccurrence();
  let resumeCompletion!: () => void, resumeTakeover!: () => void;
  let sawCompletion!: () => void, sawTakeover!: () => void;
  const completedRead = new Promise<void>((resolve) => { sawCompletion = resolve; });
  const takeoverRead = new Promise<void>((resolve) => { sawTakeover = resolve; });
  const completionGate = new Promise<void>((resolve) => { resumeCompletion = resolve; });
  const takeoverGate = new Promise<void>((resolve) => { resumeTakeover = resolve; });
  const completionTrace: Trace = { reads: 0, commits: 0, readGate: async () => { sawCompletion(); await completionGate; } };
  const takeoverTrace: Trace = { reads: 0, commits: 0, readGate: async () => { sawTakeover(); await takeoverGate; } };
  const pendingCompletion = settled(context.run(completionTrace, () => completion(id, ownerId)));
  let pendingTakeover: ReturnType<typeof settled<Awaited<ReturnType<typeof claimOccurrence>>>> | undefined;
  const waitForRead = async (ready: Promise<void>) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([ready, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Reverse race read hook missing")), 15_000); })]); }
    finally { clearTimeout(timer); }
  };
  try {
    await waitForRead(completedRead);
    await expire(id);
    pendingTakeover = settled(context.run(takeoverTrace, () => claimOccurrence(id, caregiverId)));
    await waitForRead(takeoverRead);
    resumeCompletion();
    assert.equal((await pendingCompletion).value?.kind, "accepted");
    resumeTakeover();
    const takeoverResult = await pendingTakeover;
    if (takeoverResult.error) throw takeoverResult.error;
    assert.equal(takeoverResult.value?.kind, "already_recorded");
    assert.equal(completionTrace.commits, 1);
    assert.equal(takeoverTrace.commits, 0);
    assert.equal((await occurrence(id)).status, "completed");
    await eventCounts(id, 1);
    console.log("PASS simultaneous takeover/completion: completion wins; stale takeover cannot commit");
  } finally {
    resumeCompletion(); resumeTakeover();
    await pendingCompletion; await pendingTakeover;
  }
}

try {
  const circle = await tables.getRow({ databaseId, tableId: TABLES.circles, rowId: circleId });
  await tables.createRow({ databaseId, tableId: TABLES.schedules, rowId: scheduleId, data: {
    circleId, recipientId, title: "Synthetic lease fencing", instruction: "Test only", localTime: "00:00", timezone: "UTC", rrule: "FREQ=DAILY", active: true,
  }, permissions: [] });
  for (let i = 0; i < (transitionsOnly ? 0 : 24); i++) {
    const userId = `fence_u_${run}_${i}`;
    await users.create({ userId, email: `${userId}@example.invalid`, name: `Synthetic contender ${i + 2}` });
    extraUsers.push(userId);
    await teams.createMembership({ teamId: String(circle.teamId), membershipId: `fence_m_${run}_${i}`, userId, roles: ["caregiver"] });
    const rowId = stableRowId("mem", `${circleId}:${userId}`);
    await tables.createRow({ databaseId, tableId: TABLES.members, rowId, data: { circleId, userId, role: "caregiver", status: "active", lastMutationAt: null }, permissions: [] });
    extraMembers.push(rowId);
  }
  const actors = [caregiverId, ...extraUsers];
  assert.equal(new Set(actors).size, transitionsOnly ? 1 : 25);
  // Repeats include the exact 0–600ms stagger that previously allowed two commits.
  for (const mode of transitionsOnly ? [] : ["initial", "read-barrier", "stagger", "stagger", "stagger", "commit-barrier"]) {
    const id = await newOccurrence(mode !== "initial");
    if (mode !== "initial") await expire(id);
    const before = await occurrence(id);
    const readGate = mode === "read-barrier" ? barrier(25) : undefined;
    const commitGate = mode === "commit-barrier" ? barrier(25) : undefined;
    const traces: Trace[] = actors.map((_, i) => ({ reads: 0, commits: 0, readGate, commitGate, readDelay: mode === "stagger" ? (i % 5) * 150 : 0 }));
    const results = await drain(actors.map((actor, i) => context.run(traces[i], () => claimOccurrence(id, actor))));
    const winners = results.filter((r) => r.kind === "claimed");
    assert.equal(winners.length, 1, `${mode}: exactly one successful takeover`);
    assert.equal(traces.reduce((sum, t) => sum + t.commits, 0), 1, "Exactly one database commit, not merely one success response");
    if (mode !== "initial") assert.equal(traces.reduce((sum, t) => sum + t.reads, 0), 25);
    const final = await occurrence(id);
    assert.equal(final.version, before.version + 1);
    const holder = winners[0].occurrence.claimedBy;
    assert.ok(holder);
    assert.equal(final.claimedBy, holder);
    const claim = await tables.getRow({ databaseId, tableId: TABLES.claims, rowId: stableRowId("clm", id) });
    assert.equal(claim.actorId, holder);
    assert.equal(claim.claimedAt, final.claimedAt);
    assert.equal((await rows(TABLES.claims, id)).length, 1);
    for (const result of results) {
      assert.ok(result.kind === "claimed" || result.kind === "already_claimed");
      assert.equal(result.occurrence.claimedBy, holder, "Every loser must see the authoritative holder");
      assert.equal(result.occurrence.claimedAt, final.claimedAt);
    }
    const views = await Promise.all(actors.map((actor) => getOccurrenceClaimState(id, actor)));
    assert.ok(views.every((view) => view.occurrence.claimedBy === holder));
    await eventCounts(id, 0);
    const rejected = await Promise.all([ownerId, ...actors.filter((actor) => actor !== holder)].map((actor) => settled(completion(id, actor))));
    assert.ok(rejected.every((result) => result.error instanceof CompletionClaimedByAnotherError));
    await eventCounts(id, 0);
    const completions = await drain(Array.from({ length: 25 }, () => completion(id, holder)));
    assert.equal(completions.filter((result) => result.kind === "accepted").length, 1);
    assert.equal(completions.filter((result) => result.kind === "already_recorded").length, 24);
    assert.equal((await occurrence(id)).version, before.version + 2);
    await eventCounts(id, 1);
    console.log(`PASS ${mode}: 25 requests, one claim commit, 24 accurate conflicts; 25 non-holders blocked; one completion/event/receipt`);
  }
  for (const mode of ["takeover", "release", "release-reclaim", "completion-before-release"] as const) await staleRace(mode);
  await takeoverAfterCompletion();
  for (let round = 0; round < 3; round++) {
    const id = await newOccurrence();
    const outcomes = await Promise.all([settled(releaseOccurrenceClaim(id, ownerId)), settled(completion(id, ownerId))]);
    const final = await occurrence(id);
    const successes = outcomes.filter((r) => r.value?.kind === "released" || r.value?.kind === "accepted");
    assert.equal(successes.length, 1, "Release and completion cannot both commit from the same lease");
    assert.equal(final.version, 2);
    await eventCounts(id, final.status === "due" ? 0 : 1);
    console.log(`PASS simultaneous release/completion ${round + 1}: ${successes[0].value?.kind}`);
  }
  console.log(transitionsOnly ? "OneDose transition interleavings proof passed (contention rounds not run)" : "OneDose occurrence fencing proof passed");
} finally {
  for (const { prototype, getRow, updateTransaction } of originals) { prototype.getRow = getRow; prototype.updateTransaction = updateTransaction; }
  const failures: unknown[] = [];
  const remove = async (operation: () => Promise<unknown>) => { try { await operation(); } catch (error) { if ((error as { code?: number }).code !== 404) failures.push(error); } };
  for (const id of occurrenceIds) for (const tableId of [TABLES.claims, TABLES.events, TABLES.commands]) {
    await remove(async () => { for (const row of await rows(tableId, id)) { assert.equal(row.occurrenceId, id); await tables.deleteRow({ databaseId, tableId, rowId: row.$id }); } });
  }
  for (const rowId of extraMembers) await remove(() => tables.deleteRow({ databaseId, tableId: TABLES.members, rowId }));
  for (const userId of extraUsers) await remove(() => users.delete({ userId }));
  await remove(() => fixture.cleanup());
  for (const id of occurrenceIds) for (const tableId of [TABLES.claims, TABLES.events, TABLES.commands]) await remove(async () => assert.equal((await rows(tableId, id)).length, 0));
  if (failures.length) throw new AggregateError(failures, `Fencing cleanup incomplete; inspect only ${circleId}`);
  console.log("Verified isolated fencing cleanup; public demo untouched");
}
