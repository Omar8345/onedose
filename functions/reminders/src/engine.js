import { createHash } from "node:crypto";

import { Permission, Query, Role } from "node-appwrite";

export const TABLES = {
  circles: "care_circles",
  members: "circle_members",
  schedules: "schedules",
  occurrences: "occurrences",
  notifications: "notification_deliveries",
};

const PAGE_SIZE = 100;
const RETRY_AFTER_MINUTES = 15;

function isConflict(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === 409;
}

function stableId(prefix, value) {
  const hash = createHash("sha256").update(value).digest("hex");
  return `${prefix}_${hash.slice(0, 36 - prefix.length - 1)}`;
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

function localDateKey(date, timezone) {
  const parts = localParts(date, timezone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function localTimeTodayAsUtc(localTime, timezone, now) {
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

async function listAllRows(tables, databaseId, tableId, queries = []) {
  const rows = [];
  let offset = 0;

  while (true) {
    const page = await tables.listRows({
      databaseId,
      tableId,
      queries: [...queries, Query.limit(PAGE_SIZE), Query.offset(offset)],
      total: false,
    });
    rows.push(...page.rows);
    if (page.rows.length < PAGE_SIZE) return rows;
    offset += PAGE_SIZE;
  }
}

async function materializeCircle(tables, databaseId, circle, now) {
  const schedules = await listAllRows(tables, databaseId, TABLES.schedules, [
    Query.equal("circleId", [circle.$id]),
    Query.equal("active", [true]),
  ]);
  let created = 0;

  await Promise.all(schedules.map(async (schedule) => {
    if (schedule.rrule !== "FREQ=DAILY") return;
    const dueAt = localTimeTodayAsUtc(schedule.localTime, schedule.timezone, now);
    const dateKey = localDateKey(new Date(dueAt), circle.timezone);
    const rowId = stableId("occ", `${schedule.$id}:${dateKey}`);

    try {
      await tables.createRow({
        databaseId,
        tableId: TABLES.occurrences,
        rowId,
        data: {
          circleId: circle.$id,
          teamId: circle.teamId,
          scheduleId: schedule.$id,
          dueAt,
          status: "due",
          outcome: null,
          completedBy: null,
          completedAt: null,
          activeEventId: null,
          version: 0,
        },
        permissions: [Permission.read(Role.team(circle.teamId))],
      });
      created += 1;
    } catch (error) {
      if (!isConflict(error)) throw error;
    }
  }));

  return { schedules, created };
}

async function claimDelivery(tables, databaseId, occurrence, kind, recipientCount, now) {
  const rowId = stableId("ntf", `${occurrence.$id}:${kind}`);
  const data = {
    circleId: occurrence.circleId,
    occurrenceId: occurrence.$id,
    kind,
    status: "claimed",
    recipientCount,
    claimedAt: now.toISOString(),
    sentAt: null,
    lastError: null,
    messageId: stableId("msg", `${occurrence.$id}:${kind}`),
  };

  try {
    return {
      claimed: true,
      row: await tables.createRow({
        databaseId,
        tableId: TABLES.notifications,
        rowId,
        data,
        permissions: [],
      }),
    };
  } catch (error) {
    if (!isConflict(error)) throw error;
  }

  const existing = await tables.getRow({ databaseId, tableId: TABLES.notifications, rowId });
  if (["sent", "dry_run"].includes(existing.status)) return { claimed: false, row: existing };
  const retryAt = Date.parse(existing.claimedAt) + RETRY_AFTER_MINUTES * 60_000;
  if (existing.status === "claimed" && retryAt > now.getTime()) return { claimed: false, row: existing };

  return {
    claimed: true,
    row: await tables.updateRow({
      databaseId,
      tableId: TABLES.notifications,
      rowId,
      data: { ...data, sentAt: null, lastError: null },
    }),
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function emailFor({ kind, circle, schedule, dueAt, appUrl }) {
  const overdue = kind === "overdue";
  const title = schedule?.title || "A scheduled care action";
  const time = new Intl.DateTimeFormat("en", {
    timeZone: circle.timezone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(dueAt));
  const subject = overdue ? `OneDose alert: ${title} is overdue` : `OneDose reminder: ${title} is due`;
  const message = overdue
    ? `No outcome has been recorded for ${title}, due at ${time}. Please check with the care circle before acting.`
    : `${title} is due at ${time}. Open OneDose to record the outcome.`;

  return {
    subject,
    content: `<div style="font-family:Arial,sans-serif;line-height:1.55;color:#17251f"><h2>${escapeHtml(subject)}</h2><p>${escapeHtml(message)}</p><p><strong>${escapeHtml(circle.name)}</strong></p><p><a href="${escapeHtml(appUrl)}">Open OneDose</a></p><p style="color:#66736d;font-size:13px">OneDose coordinates shared care records. Confirm the situation with your care circle before acting.</p></div>`,
  };
}

async function finishDelivery(tables, databaseId, deliveryId, data) {
  return tables.updateRow({
    databaseId,
    tableId: TABLES.notifications,
    rowId: deliveryId,
    data,
  });
}

async function processOccurrence({ tables, messaging, databaseId, circle, schedules, occurrence, now, overdueMinutes, appUrl, dryRun }) {
  const ageMs = now.getTime() - Date.parse(occurrence.dueAt);
  const kind = ageMs >= overdueMinutes * 60_000 ? "overdue" : "due";
  const members = await listAllRows(tables, databaseId, TABLES.members, [
    Query.equal("circleId", [circle.$id]),
    Query.equal("status", ["active"]),
  ]);
  const userIds = [...new Set(members.map((member) => member.userId).filter(Boolean))];
  const claim = await claimDelivery(tables, databaseId, occurrence, kind, userIds.length, now);
  if (!claim.claimed) return { kind, result: "duplicate" };

  if (dryRun) {
    await finishDelivery(tables, databaseId, claim.row.$id, {
      status: "dry_run",
      sentAt: now.toISOString(),
      lastError: null,
    });
    return { kind, result: "dryRun" };
  }

  if (!userIds.length) {
    await finishDelivery(tables, databaseId, claim.row.$id, {
      status: "failed",
      lastError: "No active caregiver accounts were found.",
    });
    return { kind, result: "failed" };
  }

  const schedule = schedules.get(occurrence.scheduleId);
  const email = emailFor({ kind, circle, schedule, dueAt: occurrence.dueAt, appUrl });

  try {
    await messaging.createEmail({
      messageId: claim.row.messageId,
      subject: email.subject,
      content: email.content,
      users: userIds,
      draft: false,
      html: true,
    });
    await finishDelivery(tables, databaseId, claim.row.$id, {
      status: "sent",
      sentAt: now.toISOString(),
      lastError: null,
    });
    return { kind, result: "sent" };
  } catch (error) {
    if (isConflict(error)) {
      await finishDelivery(tables, databaseId, claim.row.$id, {
        status: "sent",
        sentAt: now.toISOString(),
        lastError: null,
      });
      return { kind, result: "sent" };
    }

    const message = error instanceof Error ? error.message.slice(0, 500) : "Unknown messaging error";
    await finishDelivery(tables, databaseId, claim.row.$id, {
      status: "failed",
      lastError: message,
    });
    return { kind, result: "failed" };
  }
}

export async function runReminderSweep({
  tables,
  messaging,
  databaseId,
  now = new Date(),
  overdueMinutes = 60,
  appUrl = "https://onedose.appwrite.network",
  dryRun = false,
  onlyOccurrenceIds = /** @type {string[] | null} */ (null),
  skipMaterialization = false,
}) {
  const circles = await listAllRows(tables, databaseId, TABLES.circles, [Query.isNull("archivedAt")]);
  const onlyIds = onlyOccurrenceIds ? new Set(onlyOccurrenceIds) : null;
  const summary = { circles: circles.length, created: 0, due: 0, overdue: 0, sent: 0, dryRun: 0, duplicate: 0, failed: 0 };

  for (const circle of circles) {
    const materialized = skipMaterialization
      ? {
          schedules: await listAllRows(tables, databaseId, TABLES.schedules, [
            Query.equal("circleId", [circle.$id]),
            Query.equal("active", [true]),
          ]),
          created: 0,
        }
      : await materializeCircle(tables, databaseId, circle, now);
    summary.created += materialized.created;
    const schedules = new Map(materialized.schedules.map((schedule) => [schedule.$id, schedule]));
    const occurrences = await listAllRows(tables, databaseId, TABLES.occurrences, [
      Query.equal("circleId", [circle.$id]),
      Query.equal("status", ["due"]),
      Query.lessThanEqual("dueAt", now.toISOString()),
    ]);

    for (const occurrence of occurrences) {
      if (onlyIds && !onlyIds.has(occurrence.$id)) continue;
      if (!schedules.has(occurrence.scheduleId)) continue;
      const result = await processOccurrence({
        tables,
        messaging,
        databaseId,
        circle,
        schedules,
        occurrence,
        now,
        overdueMinutes,
        appUrl,
        dryRun,
      });
      summary[result.kind] += 1;
      summary[result.result] += 1;
    }
  }

  return summary;
}
