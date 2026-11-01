import { createHash } from "node:crypto";
import { Permission, Role } from "node-appwrite";
import { occurrenceRowId, existingOccurrenceForDay } from "./occurrence-identity.js";

const FENCES = "occurrence_fences";
const fenceId = id => `sched_${createHash("sha256").update(id).digest("hex").slice(0, 30)}`;
const hasCode = (error, code) => typeof error === "object" && error !== null && error.code === code;
export const isLifecycleConflict = error => hasCode(error, 409) ||
  (hasCode(error, 400) && error.type === "attribute_limit_exceeded");

// The counter precedes the schedule used for decisions. sched_ rows are permanent,
// private, and disjoint from occurrence fence_ and membership auth_ rows.
export async function readFencedSchedule(tables, databaseId, scheduleId, transactionId) {
  const rowId = fenceId(scheduleId);
  let fence;
  try {
    fence = await tables.getRow({ databaseId, tableId: FENCES, rowId, transactionId });
  } catch (error) {
    if (!(hasCode(error, 404))) throw error;
    const initial = await tables.getRow({ databaseId, tableId: "schedules", rowId: scheduleId, transactionId });
    try {
      await tables.createRow({ databaseId, tableId: FENCES, rowId,
        data: { circleId: initial.circleId, occurrenceId: scheduleId, version: 0 }, permissions: [] });
    } catch (creationError) {
      if (!(hasCode(creationError, 409))) throw creationError;
    }
    fence = await tables.getRow({ databaseId, tableId: FENCES, rowId, transactionId });
  }
  const schedule = await tables.getRow({ databaseId, tableId: "schedules", rowId: scheduleId, transactionId });
  if (fence.circleId !== schedule.circleId || fence.occurrenceId !== scheduleId) throw new Error("Schedule fence ownership mismatch.");
  return { schedule, fence };
}

export async function fenceSchedule(tables, databaseId, fence, transactionId) {
  await tables.incrementRowColumn({ databaseId, tableId: FENCES, rowId: fence.$id,
    column: "version", value: 1, max: fence.version + 1, transactionId });
}
function localParts(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  return Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]),
  );
}

export function localDateKey(date, timezone) {
  const parts = localParts(date, timezone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function localTimeTodayAsUtc(localTime, timezone, now) {
  const today = localParts(now, timezone);
  const [hour, minute] = localTime.split(":").map(Number);
  const desired = Date.UTC(today.year, today.month - 1, today.day, hour, minute, 0);
  let guess = desired;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const shown = localParts(new Date(guess), timezone);
    const shownAsUtc = Date.UTC(shown.year, shown.month - 1, shown.day, shown.hour, shown.minute, shown.second);
    guess += desired - shownAsUtc;
  }

  return new Date(guess).toISOString();
}

function weekdayCode(date, timezone) {
  const short = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: timezone }).format(date);
  return { Mon: "MO", Tue: "TU", Wed: "WE", Thu: "TH", Fri: "FR", Sat: "SA", Sun: "SU" }[short];
}

export function scheduleOccursToday(rrule, timezone, now) {
  const values = new Map(String(rrule).split(";").map((part) => {
    const [key, ...rest] = part.split("=");
    return [key, rest.join("=")];
  }));
  if (values.get("FREQ") === "WEEKLY") {
    return (values.get("BYDAY") || "").split(",").includes(weekdayCode(now, timezone));
  }
  if (values.get("FREQ") === "ONCE") {
    return values.get("DATE") === localDateKey(now, timezone);
  }
  return values.get("FREQ") === "DAILY";
}


// Caller owns the schedule fence in this transaction. Existing legacy rows and
// completed history are adopted; no occurrence counter is reset on creation.
export async function stageTodayOccurrence(tables, databaseId, circle, schedule, now, transactionId) {
  if (schedule.circleId !== circle.$id) throw new Error("Schedule circle mismatch.");
  if (!schedule.active || schedule.archivedAt || !scheduleOccursToday(schedule.rrule, schedule.timezone, now)) return false;
  const dueAt = localTimeTodayAsUtc(schedule.localTime, schedule.timezone, now);
  const dateKey = localDateKey(new Date(dueAt), schedule.timezone);
  if (await existingOccurrenceForDay(tables, databaseId, schedule.$id, dateKey, schedule.timezone, transactionId)) return false;
  await tables.createRow({ databaseId, tableId: "occurrences", rowId: occurrenceRowId(schedule.$id, dateKey),
    data: { circleId: circle.$id, teamId: circle.teamId, scheduleId: schedule.$id, dueAt,
      status: "due", outcome: null, completedBy: null, completedAt: null, activeEventId: null,
      claimedBy: null, claimedAt: null, claimExpiresAt: null, version: 0 },
    permissions: [Permission.read(Role.team(circle.teamId))], transactionId });
  return true;
}

export async function materializeSchedule(tables, databaseId, circle, listedSchedule, now) {
  if (listedSchedule.circleId !== circle.$id) throw new Error("Schedule circle mismatch.");
  // Read-only fast exits do not authorize creation. This avoids counter writes
  // and transaction overhead for ordinary views of already-materialized tasks.
  if (!listedSchedule.active || listedSchedule.archivedAt || !scheduleOccursToday(listedSchedule.rrule, listedSchedule.timezone, now)) return false;
  const listedDay = localDateKey(new Date(localTimeTodayAsUtc(listedSchedule.localTime, listedSchedule.timezone, now)), listedSchedule.timezone);
  if (await existingOccurrenceForDay(tables, databaseId, listedSchedule.$id, listedDay, listedSchedule.timezone)) return false;
  const scheduleId = listedSchedule.$id;
  const transaction = await tables.createTransaction({ ttl: 60 });
  try {
    const { schedule, fence } = await readFencedSchedule(tables, databaseId, scheduleId, transaction.$id);
    const created = await stageTodayOccurrence(tables, databaseId, circle, schedule, now, transaction.$id);
    if (!created) {
      await tables.updateTransaction({ transactionId: transaction.$id, rollback: true });
      return false;
    }
    await fenceSchedule(tables, databaseId, fence, transaction.$id);
    await tables.updateTransaction({ transactionId: transaction.$id, commit: true });
    return true;
  } catch (error) {
    await tables.updateTransaction({ transactionId: transaction.$id, rollback: true }).catch(() => undefined);
    // A competing creation or schedule edit is an expected losing transition.
    // Never retry a write or turn a provider/network error into a conflict.
    if (isLifecycleConflict(error)) return false;
    throw error;
  }
}

export async function patchSchedule(tables, databaseId, scheduleId, circleId, data) {
  const transaction = await tables.createTransaction({ ttl: 60 });
  try {
    const { schedule, fence } = await readFencedSchedule(tables, databaseId, scheduleId, transaction.$id);
    if (schedule.circleId !== circleId) throw new Error("Schedule circle mismatch.");
    await fenceSchedule(tables, databaseId, fence, transaction.$id);
    const updated = await tables.updateRow({ databaseId, tableId: "schedules", rowId: scheduleId, data, transactionId: transaction.$id });
    await tables.updateTransaction({ transactionId: transaction.$id, commit: true });
    return updated;
  } catch (error) {
    await tables.updateTransaction({ transactionId: transaction.$id, rollback: true }).catch(() => undefined);
    throw error;
  }
}
