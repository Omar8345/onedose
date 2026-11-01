import "server-only";

import { AppwriteException, type TablesDB, type Models } from "node-appwrite";

import { stableRowId } from "@/lib/domain/ids";
import { TABLES, type OccurrenceRow } from "@/lib/domain/schema";

type FenceRow = Models.Row & { circleId: string; occurrenceId: string; version: number };

// Read the permanent counter BEFORE the occurrence used for decisions. Never
// delete this counter during schedule edits, even when the occurrence is absent.
export async function readFencedOccurrence(tables: TablesDB, databaseId: string, occurrenceId: string, transactionId: string) {
  const rowId = stableRowId("fence", occurrenceId);
  let fence: FenceRow;
  try {
    fence = await tables.getRow<FenceRow>({ databaseId, tableId: TABLES.fences, rowId, transactionId });
  } catch (error) {
    if (!(error instanceof AppwriteException && error.code === 404)) throw error;
    // This first occurrence read supplies ownership only; discard it for decisions.
    const initial = await tables.getRow<OccurrenceRow>({ databaseId, tableId: TABLES.occurrences, rowId: occurrenceId, transactionId });
    try {
      await tables.createRow({ databaseId, tableId: TABLES.fences, rowId,
        data: { circleId: initial.circleId, occurrenceId, version: 0 }, permissions: [] });
    } catch (creationError) {
      if (!(creationError instanceof AppwriteException && creationError.code === 409)) throw creationError;
    }
    fence = await tables.getRow<FenceRow>({ databaseId, tableId: TABLES.fences, rowId, transactionId });
  }
  const occurrence = await tables.getRow<OccurrenceRow>({ databaseId, tableId: TABLES.occurrences, rowId: occurrenceId, transactionId });
  if (fence.circleId !== occurrence.circleId || fence.occurrenceId !== occurrenceId) throw new Error("Occurrence fence ownership mismatch.");
  return { occurrence, fence };
}

// Both bounds and all dependent writes belong to the same transaction. The
// permanent counter prevents ABA when a deterministic occurrence ID is recreated.
export async function fenceOccurrence(
  tables: TablesDB,
  databaseId: string,
  occurrence: OccurrenceRow,
  transactionId: string,
  fence: FenceRow,
) {
  await tables.incrementRowColumn({
    databaseId, tableId: TABLES.fences, rowId: fence.$id, column: "version",
    value: 1, max: fence.version + 1, transactionId,
  });
  await tables.incrementRowColumn({
    databaseId,
    tableId: TABLES.occurrences,
    rowId: occurrence.$id,
    column: "version",
    value: 1,
    max: occurrence.version + 1,
    transactionId,
  });
}

export function isOccurrenceConflict(error: unknown) {
  return error instanceof AppwriteException && (error.code === 409
    || (error.code === 400 && error.type === "attribute_limit_exceeded"));
}
