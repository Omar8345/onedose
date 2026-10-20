import "server-only";

import { Query, type Models } from "node-appwrite";

import { getServerAppwrite } from "@/lib/appwrite/server";
import { TABLES, type OccurrenceRow } from "@/lib/domain/schema";
import type { CareCircle, Occurrence, TimelineEvent } from "@/lib/types";

const DEMO = {
  circleId: "demo_circle_nora",
  recipientId: "demo_recipient_nora",
  scheduleId: "demo_schedule_midday",
};

type CircleRow = Models.Row & { name: string; timezone: string };
type RecipientRow = Models.Row & { displayName: string };
type ScheduleRow = Models.Row & {
  title: string;
  instruction: string | null;
  localTime: string;
  timezone: string;
};
type MemberRow = Models.Row & {
  userId: string;
  role: "owner" | "caregiver" | "viewer";
  status: "active" | "revoked";
};
type EventRow = Models.Row & {
  actorId: string;
  type: "outcome_recorded" | "outcome_corrected";
  outcome: string;
  note: string | null;
  occurredAt: string;
};

const people: Record<string, { name: string; initials: string; color: string }> = {
  demo_omar: { name: "Omar", initials: "OM", color: "coral" },
  demo_maya: { name: "Maya", initials: "MC", color: "sage" },
};

function person(actorId: string) {
  return people[actorId] ?? { name: "Caregiver", initials: "CG", color: "amber" };
}

function formatTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(value));
}

function occurrenceView(row: OccurrenceRow, schedule: ScheduleRow): Occurrence {
  const isRecorded = row.status !== "due";
  const isFuture = Date.parse(row.dueAt) > Date.now();

  return {
    id: row.$id,
    time: formatTime(row.dueAt, schedule.timezone),
    title: schedule.title,
    detail: schedule.instruction ?? "Scheduled care action",
    instruction: schedule.instruction ?? "Record the outcome when complete.",
    status: isRecorded ? "completed" : isFuture ? "upcoming" : "due",
    completedBy: row.completedBy ? person(row.completedBy).name : undefined,
    completedAt: row.completedAt ? formatTime(row.completedAt, schedule.timezone) : undefined,
  };
}

function eventView(row: EventRow, timezone: string): TimelineEvent {
  const actor = person(row.actorId).name;
  const corrected = row.type === "outcome_corrected";

  return {
    id: row.$id,
    time: formatTime(row.occurredAt, timezone),
    title: corrected ? "Outcome corrected" : "Midday routine recorded",
    detail: row.note ? `${actor}: ${row.note}` : `${actor} recorded ${row.outcome}`,
    tone: corrected ? "attention" : "success",
  };
}

export async function getDemoCircle(): Promise<CareCircle> {
  const { databaseId, tables } = getServerAppwrite();
  const [circle, recipient, schedule, memberships, occurrences, events] = await Promise.all([
    tables.getRow<CircleRow>({ databaseId, tableId: TABLES.circles, rowId: DEMO.circleId }),
    tables.getRow<RecipientRow>({ databaseId, tableId: TABLES.recipients, rowId: DEMO.recipientId }),
    tables.getRow<ScheduleRow>({ databaseId, tableId: TABLES.schedules, rowId: DEMO.scheduleId }),
    tables.listRows<MemberRow>({
      databaseId,
      tableId: TABLES.members,
      queries: [Query.equal("circleId", [DEMO.circleId]), Query.equal("status", ["active"]), Query.limit(25)],
      total: false,
    }),
    tables.listRows<OccurrenceRow>({
      databaseId,
      tableId: TABLES.occurrences,
      queries: [Query.equal("scheduleId", [DEMO.scheduleId]), Query.orderAsc("dueAt"), Query.limit(25)],
      total: false,
    }),
    tables.listRows<EventRow>({
      databaseId,
      tableId: TABLES.events,
      queries: [Query.equal("circleId", [DEMO.circleId]), Query.orderDesc("recordedAt"), Query.limit(25)],
      total: false,
    }),
  ]);

  const members = memberships.rows.map((membership) => person(membership.userId));
  const dateLabel = new Intl.DateTimeFormat("en", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: circle.timezone,
  }).format(new Date());

  return {
    recipient: circle.name || `${recipient.displayName}’s care`,
    timezone: circle.timezone,
    dateLabel,
    members,
    occurrences: occurrences.rows.map((row) => occurrenceView(row, schedule)),
    timeline: events.rows.map((row) => eventView(row, circle.timezone)),
  };
}
