import "server-only";

import { AppwriteException, Query, type Models } from "node-appwrite";

import { getServerAppwrite } from "@/lib/appwrite/server";
import { getSessionServices } from "@/lib/auth/session";
import {
  TABLES,
  type CaregiverPreferenceRow,
  type CircleSettingsRow,
  type MemberRow,
  type OccurrenceRow,
} from "@/lib/domain/schema";
import { stableRowId } from "@/lib/domain/ids";
import { localDateKey, localDateLabel } from "@/lib/domain/time";
import type { CareCircle, Occurrence, TimelineEvent } from "@/lib/types";

type CircleRow = Models.Row & { name: string; timezone: string; teamId: string };
type RecipientRow = Models.Row & { displayName: string };
type ScheduleRow = Models.Row & {
  title: string;
  instruction: string | null;
  localTime: string;
  timezone: string;
  active: boolean;
  archivedAt: string | null;
};
type EventRow = Models.Row & {
  occurrenceId: string;
  actorId: string;
  type: "outcome_recorded" | "outcome_corrected";
  outcome: string;
  note: string | null;
  occurredAt: string;
  supersedesEventId: string | null;
};

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "CG";
}
function formatTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit", timeZone: timezone }).format(new Date(value));
}

export async function getCareCircle(circleId: string, viewer: { id: string; name: string }): Promise<CareCircle> {
  const { databaseId, tables, teams } = getServerAppwrite();
  const circle = await tables.getRow<CircleRow>({ databaseId, tableId: TABLES.circles, rowId: circleId });
  const [recipients, schedules, circleMembers, occurrences, events, teamMemberships, preferences, settings] = await Promise.all([
    tables.listRows<RecipientRow>({ databaseId, tableId: TABLES.recipients, queries: [Query.equal("circleId", [circleId]), Query.limit(25)], total: false }),
    tables.listRows<ScheduleRow>({ databaseId, tableId: TABLES.schedules, queries: [Query.equal("circleId", [circleId]), Query.limit(100)], total: false }),
    tables.listRows<MemberRow>({ databaseId, tableId: TABLES.members, queries: [Query.equal("circleId", [circleId]), Query.equal("status", ["active"]), Query.limit(25)], total: false }),
    tables.listRows<OccurrenceRow>({ databaseId, tableId: TABLES.occurrences, queries: [Query.equal("circleId", [circleId]), Query.orderAsc("dueAt"), Query.limit(100)], total: false }),
    tables.listRows<EventRow>({ databaseId, tableId: TABLES.events, queries: [Query.equal("circleId", [circleId]), Query.orderDesc("recordedAt"), Query.limit(50)], total: false }),
    teams.listMemberships({ teamId: circle.teamId, total: false }),
    tables.listRows<CaregiverPreferenceRow>({ databaseId, tableId: TABLES.caregiverPreferences, queries: [Query.equal("circleId", [circleId]), Query.limit(100)], total: false }),
    tables.listRows<CircleSettingsRow>({ databaseId, tableId: TABLES.circleSettings, queries: [Query.equal("circleId", [circleId]), Query.limit(1)], total: false }),
  ]);

  const scheduleById = new Map(schedules.rows.map((schedule) => [schedule.$id, schedule]));
  const todayKey = localDateKey(new Date(), circle.timezone);
  const occurrenceById = new Map(occurrences.rows.map((occurrence) => [occurrence.$id, occurrence]));
  const recipient = recipients.rows[0];
  const teamMemberNames = new Map(
    teamMemberships.memberships
      .filter((membership) => membership.confirm)
      .map((membership) => [membership.userId, membership.userName.trim()]),
  );
  const viewerMembership = circleMembers.rows.find((membership) => membership.userId === viewer.id);
  if (!viewerMembership || viewerMembership.status !== "active" || !teamMemberNames.has(viewer.id)) {
    throw new CareCircleAccessError();
  }
  const person = (actorId: string) => actorId === viewer.id ? viewer.name : teamMemberNames.get(actorId) || "Caregiver";
  const availabilityByUserId = new Map(preferences.rows.map((preference) => [preference.userId, preference.availability]));
  const availability = (userId: string) => availabilityByUserId.get(userId) ?? "available";
  const occurrenceViews: Occurrence[] = occurrences.rows.flatMap((row) => {
    const schedule = scheduleById.get(row.scheduleId);
    if (!schedule || schedule.archivedAt || !schedule.active || localDateKey(new Date(row.dueAt), circle.timezone) !== todayKey) return [];
    const recorded = row.status !== "due";
    return [{
      id: row.$id,
      time: formatTime(row.dueAt, schedule.timezone),
      title: schedule.title,
      detail: schedule.instruction ?? "Scheduled care action",
      instruction: schedule.instruction ?? "Record the outcome when complete.",
      status: recorded
        ? row.status
        : Date.parse(row.dueAt) > Date.now()
          ? "upcoming"
          : Date.now() - Date.parse(row.dueAt) >= 60 * 60_000
            ? "overdue"
            : "due",
      completedBy: row.completedBy ? person(row.completedBy) : undefined,
      completedAt: row.completedAt ? formatTime(row.completedAt, schedule.timezone) : undefined,
      activeEventId: row.activeEventId ?? undefined,
    }];
  });

  const eventById = new Map(events.rows.map((event) => [event.$id, event]));
  const timeline: TimelineEvent[] = events.rows.map((event) => {
    const occurrence = occurrenceById.get(event.occurrenceId);
    const schedule = occurrence ? scheduleById.get(occurrence.scheduleId) : undefined;
    const corrected = event.type === "outcome_corrected";
    const actor = person(event.actorId);
    const previousEvent = event.supersedesEventId ? eventById.get(event.supersedesEventId) : undefined;
    const correctionDetail = previousEvent
      ? `${actor} changed ${previousEvent.outcome} to ${event.outcome}${event.note ? `: ${event.note}` : ""}`
      : `${actor} corrected the outcome to ${event.outcome}${event.note ? `: ${event.note}` : ""}`;
    return {
      id: event.$id,
      dateKey: localDateKey(new Date(event.occurredAt), circle.timezone),
      dateLabel: localDateLabel(new Date(event.occurredAt), circle.timezone),
      time: formatTime(event.occurredAt, circle.timezone),
      title: corrected ? `${schedule?.title ?? "Care action"} corrected` : `${schedule?.title ?? "Care action"} recorded`,
      detail: corrected ? correctionDetail : event.note ? `${actor}: ${event.note}` : `${actor} recorded ${event.outcome}`,
      tone: corrected ? "attention" : "success",
    };
  });

  const members = circleMembers.rows
    .filter((membership) => teamMemberNames.has(membership.userId))
    .map((membership, index) => {
    const name = person(membership.userId);
    return { id: membership.userId, name, initials: initials(name), color: (["coral", "sage", "amber"] as const)[index % 3], availability: availability(membership.userId) };
  });
  const memberByUserId = new Map(circleMembers.rows.map((membership) => [membership.userId, membership]));
  const viewerRole = circleMembers.rows.find((membership) => membership.userId === viewer.id)?.role ?? "caregiver";
  const savedPrimaryUserId = settings.rows[0]?.primaryUserId;
  const primaryUserId = savedPrimaryUserId && memberByUserId.has(savedPrimaryUserId)
    ? savedPrimaryUserId
    : circleMembers.rows.find((item) => item.role === "owner")?.userId ?? viewer.id;
  const caregivers = viewerRole === "owner"
    ? teamMemberships.memberships
      .filter((membership) => membership.userId !== viewer.id || membership.confirm)
      .flatMap((membership) => {
        const member = memberByUserId.get(membership.userId);
        const isActive = Boolean(membership.confirm && member?.status === "active");
        if (!isActive && membership.confirm) return [];
        const name = membership.userId === viewer.id
          ? viewer.name
          : membership.userName.trim() || membership.userEmail.trim() || "Caregiver";
        return [{
          membershipId: membership.$id,
          userId: membership.userId,
          name,
          email: membership.userEmail,
          role: (member?.role ?? (membership.roles.includes("owner") ? "owner" : "caregiver")) as "owner" | "caregiver" | "viewer",
          status: membership.confirm ? "active" as const : "pending" as const,
          availability: availability(membership.userId),
        }];
      })
      .sort((left, right) => Number(right.status === "active") - Number(left.status === "active") || left.name.localeCompare(right.name))
    : [];

  return {
    id: circle.$id,
    teamId: circle.teamId,
    recipient: circle.name || `${recipient?.displayName ?? "Care"} circle`,
    timezone: circle.timezone,
    dateLabel: new Intl.DateTimeFormat("en", { weekday: "long", day: "numeric", month: "long", timeZone: circle.timezone }).format(new Date()),
    viewerRole,
    viewerAvailability: availability(viewer.id),
    alertSettings: {
      primaryUserId,
      escalationMinutes: Math.max(60, settings.rows[0]?.escalationMinutes ?? 60),
    },
    members,
    caregivers,
    schedules: schedules.rows.filter((schedule) => !schedule.archivedAt).map((schedule) => ({
      id: schedule.$id,
      title: schedule.title,
      instruction: schedule.instruction ?? "",
      localTime: schedule.localTime,
      active: schedule.active,
    })),
    occurrences: occurrenceViews,
    timeline,
  };
}

export class CareCircleAccessError extends Error {
  constructor() {
    super("This caregiver no longer has access to the care circle.");
    this.name = "CareCircleAccessError";
  }
}

export async function assertCareCircleAccess(
  circleId: string,
  userId: string,
  sessionSecret: string,
) {
  const { databaseId, tables } = getServerAppwrite();
  const circle = await tables.getRow<CircleRow>({
    databaseId,
    tableId: TABLES.circles,
    rowId: circleId,
  });

  try {
    await getSessionServices(sessionSecret).teams.get({ teamId: circle.teamId });
    const member = await tables.getRow<MemberRow>({
      databaseId,
      tableId: TABLES.members,
      rowId: stableRowId("mem", `${circleId}:${userId}`),
    });
    if (member.status !== "active" || member.userId !== userId || member.circleId !== circleId) {
      throw new CareCircleAccessError();
    }
  } catch (error) {
    if (error instanceof CareCircleAccessError) throw error;
    if (error instanceof AppwriteException && (error.code === 401 || error.code === 403 || error.code === 404)) {
      throw new CareCircleAccessError();
    }
    throw error;
  }
}
