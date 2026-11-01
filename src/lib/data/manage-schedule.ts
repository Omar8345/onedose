import { readFencedSchedule, fenceSchedule, stageTodayOccurrence } from "../../../functions/reminders/src/schedule-lifecycle.js";
import { existingOccurrenceForDay } from "../../../functions/reminders/src/occurrence-identity.js";
import { requireTeamMembership } from "@/lib/data/team-authorization";
import { randomBytes } from "node:crypto";
import { isProtectedCircle, isDemoCreatedSchedule } from "@/lib/demo/protection";
import { PublicDemoRestriction, requireDemoScheduleIdentity } from "@/lib/demo/guard";
import "server-only";

import { AppwriteException, ID, Permission, Query, Role, type Models } from "node-appwrite";
import { z } from "zod";

import { getServerAppwrite } from "@/lib/appwrite/server";
import { readFencedOccurrence, fenceOccurrence, isOccurrenceConflict } from "@/lib/data/occurrence-fence";
import { ensureTodayOccurrences } from "@/lib/data/ensure-occurrences";
import { stableRowId } from "@/lib/domain/ids";
import { buildScheduleRrule, scheduleOccursToday } from "@/lib/domain/recurrence";
import { TABLES, type MemberRow } from "@/lib/domain/schema";
import { localDateKey, localTimeTodayAsUtc } from "@/lib/domain/time";

export const scheduleInputSchema = z.object({
  recipientId: z.string().min(1).max(36).optional(),
  recipientIds: z.array(z.string().min(1).max(36)).min(1).max(25).optional(),
  title: z.string().trim().min(2).max(120),
  instruction: z.string().trim().max(500).optional(),
  localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  frequency: z.enum(["daily", "weekly", "once"]).default("daily"),
  weekdays: z.array(z.enum(["MO", "TU", "WE", "TH", "FR", "SA", "SU"])).max(7).optional(),
  date: z.iso.date().optional(),
  active: z.boolean().default(true),
}).superRefine((input, context) => {
  if (input.frequency === "weekly" && !input.weekdays?.length) {
    context.addIssue({ code: "custom", path: ["weekdays"], message: "Choose at least one weekday." });
  }
  if (input.frequency === "once" && !input.date) {
    context.addIssue({ code: "custom", path: ["date"], message: "Choose the date for this action." });
  }
});

type ParsedScheduleInput = z.infer<typeof scheduleInputSchema>;
type ScheduleInput = Omit<ParsedScheduleInput, "frequency"> & {
  frequency?: ParsedScheduleInput["frequency"];
};
type CircleRow = Models.Row & { teamId: string; timezone: string };
type RecipientRow = Models.Row & { circleId: string; timezone: string | null; archivedAt: string | null };
type ScheduleRow = Models.Row & {
  circleId: string;
  recipientId: string;
  title: string;
  instruction: string | null;
  localTime: string;
  timezone: string;
  rrule: string;
  active: boolean;
  archivedAt: string | null;
};

export class ScheduleForbiddenError extends Error {
  constructor() {
    super("Only the circle owner can manage care actions.");
    this.name = "ScheduleForbiddenError";
  }
}

async function ownerContext(circleId: string, userId: string) {
  const { databaseId, tables } = getServerAppwrite();
  const [circle, member] = await Promise.all([
    tables.getRow<CircleRow>({ databaseId, tableId: TABLES.circles, rowId: circleId }),
    tables.getRow<MemberRow>({
      databaseId,
      tableId: TABLES.members,
      rowId: stableRowId("mem", `${circleId}:${userId}`),
    }),
  ]);
  if(isProtectedCircle(circleId))await requireDemoScheduleIdentity(userId);
  if (member.circleId!==circleId || member.userId!==userId || member.status !== "active" || (member.role !== "owner" && !(isProtectedCircle(circleId) && member.role==="caregiver"))) throw new ScheduleForbiddenError();
  await requireTeamMembership(circle.teamId, userId, !isProtectedCircle(circleId));
  return { databaseId, tables, circle };
}

export async function createSchedules(circleId: string, userId: string, input: ScheduleInput) {
  const { databaseId, tables, circle } = await ownerContext(circleId, userId);
  const recipients = await tables.listRows<RecipientRow>({
    databaseId,
    tableId: TABLES.recipients,
    queries: [
      Query.equal("circleId", [circleId]),
      Query.isNull("archivedAt"),
      Query.limit(25),
    ],
    total: false,
  });
  const requestedIds = [...new Set(input.recipientIds?.length ? input.recipientIds : input.recipientId ? [input.recipientId] : [recipients.rows[0]?.$id])]
    .filter((value): value is string => Boolean(value));
  const recipientById = new Map(recipients.rows.map((recipient) => [recipient.$id, recipient]));
  const selectedRecipients = requestedIds.map((id) => recipientById.get(id));
  if (!selectedRecipients.length || selectedRecipients.some((recipient) => !recipient)) {
    throw new Error("One or more care recipients no longer exist.");
  }

  const schedules: ScheduleRow[] = [];
  const rrule = buildScheduleRrule(input);
  const transaction = await tables.createTransaction({ ttl: 60 });
  try {
    for (const recipient of selectedRecipients) {
      if (!recipient) continue;
      schedules.push(await tables.createRow<ScheduleRow>({
        databaseId,
        tableId: TABLES.schedules,
        rowId: isProtectedCircle(circleId)?`public_demo_${randomBytes(12).toString("hex")}`:ID.unique(),
        data: {
          circleId,
          recipientId: recipient.$id,
          title: input.title,
          instruction: input.instruction || null,
          localTime: input.localTime,
          timezone: recipient.timezone ?? circle.timezone,
          rrule,
          active: input.active,
          archivedAt: null,
        },
        permissions: [Permission.read(Role.team(circle.teamId))],
        transactionId: transaction.$id,
      }));
    }
    await tables.updateTransaction({ transactionId: transaction.$id, commit: true });
  } catch (error) {
    await tables.updateTransaction({ transactionId: transaction.$id, rollback: true }).catch(() => undefined);
    throw error;
  }

  if (input.active) await ensureTodayOccurrences(circleId);
  return schedules;
}

export async function createSchedule(circleId: string, userId: string, input: ScheduleInput) {
  const schedules = await createSchedules(circleId, userId, input);
  return schedules[0];
}

export async function updateSchedule(
  circleId: string,
  scheduleId: string,
  userId: string,
  input: ScheduleInput,
) {
  const { databaseId, tables, circle } = await ownerContext(circleId, userId);
  const transaction = await tables.createTransaction({ ttl: 60 });
  try {
    const { schedule, fence: scheduleFence } = await readFencedSchedule(tables, databaseId, scheduleId, transaction.$id);
    if (isProtectedCircle(circleId) && !isDemoCreatedSchedule(scheduleId)) throw new PublicDemoRestriction();
    if (schedule.circleId !== circleId) throw new ScheduleForbiddenError();
    if (schedule.archivedAt) throw new ScheduleNotFoundError();
    let recipient: RecipientRow | null = null;
    if (input.recipientId && input.recipientId !== schedule.recipientId) {
      recipient = await tables.getRow<RecipientRow>({ databaseId, tableId: TABLES.recipients, rowId: input.recipientId, transactionId: transaction.$id });
      if (recipient.circleId !== circleId || recipient.archivedAt) throw new ScheduleForbiddenError();
    }
    const timezone = recipient ? recipient.timezone ?? circle.timezone : schedule.timezone;
    const rrule = buildScheduleRrule(input);
    const now = new Date();
    await fenceSchedule(tables, databaseId, scheduleFence, transaction.$id);
    const updated = await tables.updateRow<ScheduleRow>({
      databaseId, tableId: TABLES.schedules, rowId: scheduleId,
      data: { title: input.title, recipientId: recipient?.$id ?? schedule.recipientId,
        instruction: input.instruction || null, localTime: input.localTime, rrule, active: input.active, timezone },
      transactionId: transaction.$id,
    });
    if (input.active) {
      const todayKey = localDateKey(now, timezone);
      const existing = await existingOccurrenceForDay(tables, databaseId, scheduleId, todayKey, timezone, transaction.$id);
      const occursToday = scheduleOccursToday(rrule, timezone, now);
      if (existing?.status === "due") {
        const { occurrence, fence } = await readFencedOccurrence(tables, databaseId, existing.$id, transaction.$id);
        if (occurrence.status === "due") {
          // Both retiming and deletion arbitrate with completion at commit time.
          await fenceOccurrence(tables, databaseId, occurrence, transaction.$id, fence);
          if (occursToday) {
            await tables.updateRow({ databaseId, tableId: TABLES.occurrences, rowId: occurrence.$id,
              data: { dueAt: localTimeTodayAsUtc(input.localTime, timezone, now) }, transactionId: transaction.$id });
          } else {
            try {
              const rowId = stableRowId("clm", occurrence.$id);
              await tables.getRow({ databaseId, tableId: TABLES.claims, rowId, transactionId: transaction.$id });
              await tables.deleteRow({ databaseId, tableId: TABLES.claims, rowId, transactionId: transaction.$id });
            } catch (error) {
              if (!(error instanceof AppwriteException && error.code === 404)) throw error;
            }
            await tables.deleteRow({ databaseId, tableId: TABLES.occurrences, rowId: occurrence.$id, transactionId: transaction.$id });
          }
        }
      } else if (!existing && occursToday) {
        await stageTodayOccurrence(tables, databaseId, circle, updated, now, transaction.$id);
      }
    }
    await tables.updateTransaction({ transactionId: transaction.$id, commit: true });
    return updated;
  } catch (error) {
    await tables.updateTransaction({ transactionId: transaction.$id, rollback: true }).catch(() => undefined);
    if (error instanceof AppwriteException && error.code === 404) {
      throw new AppwriteException("The care action changed during this schedule edit. Refresh and try again.", 409, "transaction_conflict");
    }
    throw error;
  }
}

export class ScheduleNotFoundError extends Error {
  constructor() {
    super("This care action no longer exists.");
    this.name = "ScheduleNotFoundError";
  }
}

export async function archiveSchedule(circleId: string, scheduleId: string, userId: string) {
  const { databaseId, tables } = await ownerContext(circleId, userId);
  const transaction = await tables.createTransaction({ ttl: 60 });
  try {
    const { schedule, fence } = await readFencedSchedule(tables, databaseId, scheduleId, transaction.$id);
    if (isProtectedCircle(circleId) && !isDemoCreatedSchedule(scheduleId)) throw new PublicDemoRestriction();
    if (schedule.circleId !== circleId) throw new ScheduleForbiddenError();
    if (schedule.archivedAt) {
      await tables.updateTransaction({ transactionId: transaction.$id, rollback: true });
      return schedule;
    }
    await fenceSchedule(tables, databaseId, fence, transaction.$id);
    const updated = await tables.updateRow<ScheduleRow>({ databaseId, tableId: TABLES.schedules, rowId: scheduleId,
      data: { active: false, archivedAt: new Date().toISOString() }, transactionId: transaction.$id });
    await tables.updateTransaction({ transactionId: transaction.$id, commit: true });
    return updated;
  } catch (error) {
    await tables.updateTransaction({ transactionId: transaction.$id, rollback: true }).catch(() => undefined);
    throw error;
  }
}

export function scheduleErrorStatus(error: unknown) {
  if (isOccurrenceConflict(error)) return 409;
  if (error instanceof ScheduleForbiddenError) return 403;
  if (error instanceof ScheduleNotFoundError) return 404;
  if (error instanceof AppwriteException && error.code === 404) return 404;
  return 500;
}
