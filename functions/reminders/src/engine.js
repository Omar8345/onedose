import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { Permission, Query, Role } from "node-appwrite";

export const TABLES = {
  circles: "care_circles",
  members: "circle_members",
  schedules: "schedules",
  occurrences: "occurrences",
  notifications: "notification_deliveries",
  caregiverPreferences: "caregiver_preferences",
  circleSettings: "care_circle_settings",
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

async function confirmedTeamUserIds(teams, teamId) {
  const userIds = new Set();
  let offset = 0;

  while (true) {
    const page = await teams.listMemberships({
      teamId,
      queries: [Query.limit(PAGE_SIZE), Query.offset(offset)],
      total: false,
    });
    for (const membership of page.memberships) {
      if (membership.confirm && membership.userId) userIds.add(membership.userId);
    }
    if (page.memberships.length < PAGE_SIZE) return userIds;
    offset += PAGE_SIZE;
  }
}

async function materializeCircle(tables, databaseId, circle, now) {
  const schedules = await listAllRows(tables, databaseId, TABLES.schedules, [
    Query.equal("circleId", [circle.$id]),
    Query.equal("active", [true]),
    Query.isNull("archivedAt"),
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

const EMAIL_TEMPLATES = {
  due: readFileSync(new URL("./emails/reminder.html", import.meta.url), "utf8"),
  overdue: readFileSync(new URL("./emails/overdue.html", import.meta.url), "utf8"),
};

function renderEmailTemplate(template, values) {
  return Object.entries(values).reduce(
    (output, [key, value]) => output.replaceAll(`{{${key}}}`, escapeHtml(value)),
    template,
  );
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
  const heading = overdue ? `${title} is overdue` : `${title} is due`;
  const message = overdue
    ? `No outcome has been recorded for this action, due at ${time}. Please check with the care circle before acting.`
    : `This action is due at ${time}. Open OneDose to record what happened for everyone helping with care.`;

  return {
    subject,
    content: renderEmailTemplate(EMAIL_TEMPLATES[kind], {
      subject,
      preheader: `${heading} in ${circle.name}.`,
      heading,
      message,
      circle: circle.name,
      appUrl,
      buttonLabel: overdue ? "Check care circle" : "Record outcome",
    }),
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

async function deliveryFor(tables, databaseId, occurrenceId, kind) {
  try {
    return await tables.getRow({
      databaseId,
      tableId: TABLES.notifications,
      rowId: stableId("ntf", `${occurrenceId}:${kind}`),
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === 404) return null;
    throw error;
  }
}

async function processOccurrence({ tables, messaging, databaseId, circle, confirmedUserIds, schedules, occurrence, now, overdueMinutes, appUrl, dryRun }) {
  const [members, preferences, settingsRows] = await Promise.all([
    listAllRows(tables, databaseId, TABLES.members, [
      Query.equal("circleId", [circle.$id]),
      Query.equal("status", ["active"]),
    ]),
    listAllRows(tables, databaseId, TABLES.caregiverPreferences, [Query.equal("circleId", [circle.$id])]),
    listAllRows(tables, databaseId, TABLES.circleSettings, [Query.equal("circleId", [circle.$id])]),
  ]);
  const settings = settingsRows[0];
  const delayMinutes = Math.max(60, settings?.escalationMinutes ?? overdueMinutes);
  const dueDelivery = await deliveryFor(tables, databaseId, occurrence.$id, "due");
  const dueWasDelivered = dueDelivery && ["sent", "dry_run"].includes(dueDelivery.status);
  const firstReminderAt = dueDelivery?.sentAt || dueDelivery?.claimedAt;
  if (dueWasDelivered && firstReminderAt && now.getTime() < Date.parse(firstReminderAt) + delayMinutes * 60_000) {
    return { kind: "due", result: "waiting" };
  }
  const kind = dueWasDelivered ? "overdue" : "due";
  const unavailable = new Set(preferences.filter((item) => item.availability === "unavailable").map((item) => item.userId));
  const availableMembers = members
    .filter((member) => member.userId && confirmedUserIds.has(member.userId) && !unavailable.has(member.userId))
    .sort((left, right) => Number(right.role === "owner") - Number(left.role === "owner") || left.userId.localeCompare(right.userId));
  const availableUserIds = [...new Set(availableMembers.map((member) => member.userId))];
  const primaryUserId = settings?.primaryUserId;
  const firstContact = primaryUserId && availableUserIds.includes(primaryUserId)
    ? primaryUserId
    : availableUserIds[0];
  const userIds = kind === "due" ? (firstContact ? [firstContact] : []) : availableUserIds;
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
  teams,
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
  const summary = { circles: circles.length, created: 0, due: 0, overdue: 0, waiting: 0, sent: 0, dryRun: 0, duplicate: 0, failed: 0 };

  for (const circle of circles) {
    const confirmedUserIds = await confirmedTeamUserIds(teams, circle.teamId);
    const materialized = skipMaterialization
      ? {
          schedules: await listAllRows(tables, databaseId, TABLES.schedules, [
            Query.equal("circleId", [circle.$id]),
            Query.equal("active", [true]),
            Query.isNull("archivedAt"),
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

    const todayKey = localDateKey(now, circle.timezone);
    for (const occurrence of occurrences) {
      if (onlyIds && !onlyIds.has(occurrence.$id)) continue;
      if (localDateKey(new Date(occurrence.dueAt), circle.timezone) !== todayKey) continue;
      if (!schedules.has(occurrence.scheduleId)) continue;
      const result = await processOccurrence({
        tables,
        messaging,
        databaseId,
        circle,
        confirmedUserIds,
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
