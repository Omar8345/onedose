import "server-only";

import { AppwriteException, Permission, Role } from "node-appwrite";

import { getServerAppwrite } from "@/lib/appwrite/server";
import {
  completionInputSchema,
  TABLES,
  type CommandReceiptRow,
  type CompletionInput,
  type CompletionResult,
  type MemberRow,
  type OccurrenceRow,
} from "@/lib/domain/schema";
import { stableHash, stableRowId } from "@/lib/domain/ids";
import { canReadOrRecordCircle } from "@/lib/data/caregiver-policy";

const TRANSACTION_TTL_SECONDS = 60;

export class CompletionInputConflictError extends Error {
  constructor() {
    super("This idempotency key was already used with different completion data.");
    this.name = "CompletionInputConflictError";
  }
}

export class CompletionForbiddenError extends Error {
  constructor() {
    super("The caregiver is not allowed to update this care circle.");
    this.name = "CompletionForbiddenError";
  }
}

function fingerprint(input: CompletionInput) {
  return stableHash(JSON.stringify({
    occurrenceId: input.occurrenceId,
    actorId: input.actorId,
    outcome: input.outcome,
    note: input.note ?? "",
    occurredAt: input.occurredAt,
    correctsEventId: input.correctsEventId ?? "",
  }));
}

function isMissing(error: unknown) {
  return error instanceof AppwriteException && error.code === 404;
}

function isConflict(error: unknown) {
  return error instanceof AppwriteException && error.code === 409;
}

export async function completeOccurrence(rawInput: unknown): Promise<CompletionResult> {
  const input = completionInputSchema.parse(rawInput);
  const { databaseId, tables } = getServerAppwrite();
  const commandId = stableRowId("cmd", `${input.actorId}:${input.idempotencyKey}`);
  const requestFingerprint = fingerprint(input);

  try {
    const existing = await tables.getRow<CommandReceiptRow>({
      databaseId,
      tableId: TABLES.commands,
      rowId: commandId,
    });

    if (existing.requestFingerprint !== requestFingerprint) {
      throw new CompletionInputConflictError();
    }

    const occurrence = await tables.getRow<OccurrenceRow>({
      databaseId,
      tableId: TABLES.occurrences,
      rowId: existing.occurrenceId,
    });

    return { kind: "replayed", occurrence, eventId: existing.eventId };
  } catch (error) {
    if (!isMissing(error)) throw error;
  }

  const transaction = await tables.createTransaction({ ttl: TRANSACTION_TTL_SECONDS });

  try {
    const occurrence = await tables.getRow<OccurrenceRow>({
      databaseId,
      tableId: TABLES.occurrences,
      rowId: input.occurrenceId,
      transactionId: transaction.$id,
    });
    const memberId = stableRowId("mem", `${occurrence.circleId}:${input.actorId}`);
    let member: MemberRow;
    try {
      member = await tables.getRow<MemberRow>({
        databaseId,
        tableId: TABLES.members,
        rowId: memberId,
        transactionId: transaction.$id,
      });
    } catch (error) {
      if (isMissing(error)) throw new CompletionForbiddenError();
      throw error;
    }

    if (member.circleId !== occurrence.circleId || !canReadOrRecordCircle(member, input.actorId)) {
      throw new CompletionForbiddenError();
    }

    const isCorrection = Boolean(input.correctsEventId);
    const isCurrentCorrection = isCorrection
      && occurrence.status !== "due"
      && occurrence.activeEventId === input.correctsEventId;

    if ((!isCorrection && occurrence.status !== "due") || (isCorrection && !isCurrentCorrection)) {
      await tables.updateTransaction({ transactionId: transaction.$id, rollback: true });
      return { kind: "already_recorded", occurrence };
    }

    // Every contender writes the same immutable event row. Its unique row ID
    // makes Appwrite reject all but one concurrent completion transaction.
    const eventId = isCorrection
      ? stableRowId("evt", `${occurrence.$id}:correct:${input.correctsEventId}`)
      : stableRowId("evt", occurrence.$id);
    const now = new Date().toISOString();

    // Touching membership makes a concurrent revocation conflict with this commit.
    await tables.updateRow<MemberRow>({
      databaseId,
      tableId: TABLES.members,
      rowId: memberId,
      data: { lastMutationAt: now },
      transactionId: transaction.$id,
    });

    await tables.updateRow<OccurrenceRow>({
      databaseId,
      tableId: TABLES.occurrences,
      rowId: occurrence.$id,
      data: {
        status: input.outcome,
        outcome: input.outcome,
        completedBy: input.actorId,
        completedAt: input.occurredAt,
        activeEventId: eventId,
        version: occurrence.version + 1,
      },
      transactionId: transaction.$id,
    });

    await tables.createRow({
      databaseId,
      tableId: TABLES.events,
      rowId: eventId,
      data: {
        circleId: occurrence.circleId,
        occurrenceId: occurrence.$id,
        actorId: input.actorId,
        type: isCorrection ? "outcome_corrected" : "outcome_recorded",
        outcome: input.outcome,
        note: input.note ?? null,
        occurredAt: input.occurredAt,
        recordedAt: now,
        supersedesEventId: input.correctsEventId ?? null,
      },
      permissions: [Permission.read(Role.team(occurrence.teamId))],
      transactionId: transaction.$id,
    });

    await tables.createRow({
      databaseId,
      tableId: TABLES.commands,
      rowId: commandId,
      data: {
        occurrenceId: occurrence.$id,
        actorId: input.actorId,
        requestFingerprint,
        result: "accepted",
        eventId,
        completedAt: input.occurredAt,
      },
      permissions: [],
      transactionId: transaction.$id,
    });

    await tables.updateTransaction({ transactionId: transaction.$id, commit: true });

    const committed = await tables.getRow<OccurrenceRow>({
      databaseId,
      tableId: TABLES.occurrences,
      rowId: occurrence.$id,
    });

    return { kind: isCorrection ? "corrected" : "accepted", occurrence: committed, eventId };
  } catch (error) {
    await tables
      .updateTransaction({ transactionId: transaction.$id, rollback: true })
      .catch(() => undefined);

    if (!isConflict(error)) throw error;

    const winner = await tables.getRow<OccurrenceRow>({
      databaseId,
      tableId: TABLES.occurrences,
      rowId: input.occurrenceId,
    });

    return { kind: "already_recorded", occurrence: winner };
  }
}
