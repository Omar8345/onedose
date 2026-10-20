import "server-only";

import { AppwriteException, ID, Permission, Query, Role } from "node-appwrite";
import { z } from "zod";

import type { OneDosePrefs } from "@/lib/auth/session";
import { getServerAppwrite } from "@/lib/appwrite/server";
import { stableRowId } from "@/lib/domain/ids";
import { TABLES } from "@/lib/domain/schema";

export const onboardingSchema = z.object({
  circleName: z.string().trim().min(2).max(100),
  recipientName: z.string().trim().min(2).max(100),
  timezone: z.string().trim().min(1).max(64),
  routineTitle: z.string().trim().min(2).max(120),
  localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  instruction: z.string().trim().max(500).optional(),
});

type OnboardingInput = z.infer<typeof onboardingSchema>;

function localParts(date: Date, timezone: string) {
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
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
}

function todayAt(localTime: string, timezone: string) {
  const today = localParts(new Date(), timezone);
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

export async function createCareCircle({
  input,
  userId,
  teamId,
  account,
}: {
  input: OnboardingInput;
  userId: string;
  teamId: string;
  account: { updatePrefs: <Preferences extends OneDosePrefs>(params: { prefs: Preferences }) => Promise<unknown> };
}) {
  // Intl throws for unknown zones before any rows are staged.
  new Intl.DateTimeFormat("en", { timeZone: input.timezone }).format();

  const { databaseId, tables } = getServerAppwrite();
  const circleId = ID.unique();
  const recipientId = ID.unique();
  const scheduleId = ID.unique();
  const occurrenceId = ID.unique();
  const memberId = stableRowId("mem", `${circleId}:${userId}`);
  const teamRead = [Permission.read(Role.team(teamId))];
  const transaction = await tables.createTransaction({ ttl: 60 });

  try {
    await tables.createRow({ databaseId, tableId: TABLES.circles, rowId: circleId, data: {
      name: input.circleName,
      teamId,
      timezone: input.timezone,
      archivedAt: null,
    }, permissions: teamRead, transactionId: transaction.$id });

    await tables.createRow({ databaseId, tableId: TABLES.members, rowId: memberId, data: {
      circleId,
      userId,
      role: "owner",
      status: "active",
      lastMutationAt: null,
    }, permissions: teamRead, transactionId: transaction.$id });

    await tables.createRow({ databaseId, tableId: TABLES.recipients, rowId: recipientId, data: {
      circleId,
      displayName: input.recipientName,
      archivedAt: null,
    }, permissions: teamRead, transactionId: transaction.$id });

    await tables.createRow({ databaseId, tableId: TABLES.schedules, rowId: scheduleId, data: {
      circleId,
      recipientId,
      title: input.routineTitle,
      instruction: input.instruction || null,
      localTime: input.localTime,
      timezone: input.timezone,
      rrule: "FREQ=DAILY",
      active: true,
    }, permissions: teamRead, transactionId: transaction.$id });

    await tables.createRow({ databaseId, tableId: TABLES.occurrences, rowId: occurrenceId, data: {
      circleId,
      teamId,
      scheduleId,
      dueAt: todayAt(input.localTime, input.timezone),
      status: "due",
      outcome: null,
      completedBy: null,
      completedAt: null,
      activeEventId: null,
      version: 0,
    }, permissions: teamRead, transactionId: transaction.$id });

    await tables.updateTransaction({ transactionId: transaction.$id, commit: true });
  } catch (error) {
    await tables.updateTransaction({ transactionId: transaction.$id, rollback: true }).catch(() => undefined);
    if (!(error instanceof AppwriteException && error.code === 409)) throw error;

    const existing = await tables.listRows({
      databaseId,
      tableId: TABLES.circles,
      queries: [Query.equal("teamId", [teamId]), Query.limit(1)],
      total: false,
    });
    const recovered = existing.rows[0];
    if (!recovered) throw error;
    await account.updatePrefs({ prefs: { primaryTeamId: teamId, circleId: recovered.$id } as OneDosePrefs });
    return recovered.$id;
  }

  await account.updatePrefs({ prefs: { primaryTeamId: teamId, circleId } as OneDosePrefs });
  return circleId;
}
