import { createHash } from "node:crypto";
import { Query } from "node-appwrite";

// Shared by Next.js and the independently packaged reminder Function. Keep the
// application's original 30-hex format; notification IDs have a separate format.
export function occurrenceRowId(scheduleId, dateKey) {
  return `occ_${createHash("sha256").update(`${scheduleId}:${dateKey}`).digest("hex").slice(0, 30)}`;
}

export function occurrenceDateKey(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

// Adopt existing random/onboarding and old 32-hex worker IDs without renaming
// rows or disturbing history, claims, receipts, or permanent counters.
export async function existingOccurrenceForDay(tables, databaseId, scheduleId, dateKey, timezone, transactionId) {
  // A three-day UTC window covers the selected local date in every timezone.
  // Filter history at the database rather than imposing a 100-day lifetime limit.
  const utcDay = Date.parse(`${dateKey}T00:00:00.000Z`);
  const result = await tables.listRows({ databaseId, tableId: "occurrences",
    transactionId, queries: [Query.equal("scheduleId", [scheduleId]),
      Query.greaterThanEqual("dueAt", new Date(utcDay - 86400000).toISOString()),
      Query.lessThan("dueAt", new Date(utcDay + 2 * 86400000).toISOString()),
      Query.limit(100)], total: false });
  if (result.rows.length === 100) throw new Error("Occurrence compatibility lookup exceeded its safe limit.");
  const matches = result.rows.filter(row => occurrenceDateKey(new Date(row.dueAt), timezone) === dateKey);
  if (matches.length > 1) throw new Error("Multiple occurrences already exist for this schedule and date; review is required.");
  return matches[0];
}
