import "server-only";

import { Query, type Models } from "node-appwrite";

import { getServerAppwrite } from "@/lib/appwrite/server";
import { TABLES, type OccurrenceRow } from "@/lib/domain/schema";
import type { CareCircle, Occurrence, TimelineEvent } from "@/lib/types";

type CircleRow = Models.Row & { name: string; timezone: string };
type RecipientRow = Models.Row & { displayName: string };
type ScheduleRow = Models.Row & { title: string; instruction: string | null; timezone: string };
type MemberRow = Models.Row & {
  userId: string;
  role: "owner" | "caregiver" | "viewer";
};
type EventRow = Models.Row & {
  occurrenceId: string;
  actorId: string;
  type: "outcome_recorded" | "outcome_corrected";
  outcome: string;
  note: string | null;
  occurredAt: string;
};

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "CG";
}

function formatTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit", timeZone: timezone }).format(new Date(value));
}

export async function getCareCircle(circleId: string, viewer: { id: string; name: string }): Promise<CareCircle> {
  const { databaseId, tables } = getServerAppwrite();
  const [circle, recipients, schedules, memberships, occurrences, events] = await Promise.all([
    tables.getRow<CircleRow>({ databaseId, tableId: TABLES.circles, rowId: circleId }),
    tables.listRows<RecipientRow>({ databaseId, tableId: TABLES.recipients, queries: [Query.equal("circleId", [circleId]), Query.limit(25)], total: false }),
    tables.listRows<ScheduleRow>({ databaseId, tableId: TABLES.schedules, queries: [Query.equal("circleId", [circleId]), Query.equal("active", [true]), Query.limit(100)], total: false }),
    tables.listRows<MemberRow>({ databaseId, tableId: TABLES.members, queries: [Query.equal("circleId", [circleId]), Query.equal("status", ["active"]), Query.limit(25)], total: false }),
    tables.listRows<OccurrenceRow>({ databaseId, tableId: TABLES.occurrences, queries: [Query.equal("circleId", [circleId]), Query.orderAsc("dueAt"), Query.limit(100)], total: false }),
    tables.listRows<EventRow>({ databaseId, tableId: TABLES.events, queries: [Query.equal("circleId", [circleId]), Query.orderDesc("recordedAt"), Query.limit(50)], total: false }),
  ]);

  const scheduleById = new Map(schedules.rows.map((schedule) => [schedule.$id, schedule]));
  const occurrenceById = new Map(occurrences.rows.map((occurrence) => [occurrence.$id, occurrence]));
  const recipient = recipients.rows[0];
  const person = (actorId: string) => actorId === viewer.id ? viewer.name : "Another caregiver";
  const occurrenceViews: Occurrence[] = occurrences.rows.flatMap((row) => {
    const schedule = scheduleById.get(row.scheduleId);
    if (!schedule) return [];
    const recorded = row.status !== "due";
    return [{
      id: row.$id,
      time: formatTime(row.dueAt, schedule.timezone),
      title: schedule.title,
      detail: schedule.instruction ?? "Scheduled care action",
      instruction: schedule.instruction ?? "Record the outcome when complete.",
      status: recorded ? "completed" : Date.parse(row.dueAt) > Date.now() ? "upcoming" : "due",
      completedBy: row.completedBy ? person(row.completedBy) : undefined,
      completedAt: row.completedAt ? formatTime(row.completedAt, schedule.timezone) : undefined,
    }];
  });

  const timeline: TimelineEvent[] = events.rows.map((event) => {
    const occurrence = occurrenceById.get(event.occurrenceId);
    const schedule = occurrence ? scheduleById.get(occurrence.scheduleId) : undefined;
    const corrected = event.type === "outcome_corrected";
    const actor = person(event.actorId);
    return {
      id: event.$id,
      time: formatTime(event.occurredAt, circle.timezone),
      title: corrected ? "Outcome corrected" : `${schedule?.title ?? "Care action"} recorded`,
      detail: event.note ? `${actor}: ${event.note}` : `${actor} recorded ${event.outcome}`,
      tone: corrected ? "attention" : "success",
    };
  });

  const members = memberships.rows.map((membership, index) => {
    const name = person(membership.userId);
    return { name, initials: initials(name), color: (["coral", "sage", "amber"] as const)[index % 3] };
  });

  return {
    recipient: circle.name || `${recipient?.displayName ?? "Care"} circle`,
    timezone: circle.timezone,
    dateLabel: new Intl.DateTimeFormat("en", { weekday: "long", day: "numeric", month: "long", timeZone: circle.timezone }).format(new Date()),
    viewerRole: memberships.rows.find((membership) => membership.userId === viewer.id)?.role ?? "caregiver",
    members,
    occurrences: occurrenceViews,
    timeline,
  };
}
