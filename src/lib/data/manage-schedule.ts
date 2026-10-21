import "server-only";

import { AppwriteException, ID, Permission, Query, Role, type Models } from "node-appwrite";
import { z } from "zod";

import { getServerAppwrite } from "@/lib/appwrite/server";
import { ensureTodayOccurrences } from "@/lib/data/ensure-occurrences";
import { stableRowId } from "@/lib/domain/ids";
import { TABLES, type MemberRow, type OccurrenceRow } from "@/lib/domain/schema";
import { localDateKey, localTimeTodayAsUtc } from "@/lib/domain/time";

export const scheduleInputSchema = z.object({
  title: z.string().trim().min(2).max(120),
  instruction: z.string().trim().max(500).optional(),
  localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  active: z.boolean().default(true),
});

type ScheduleInput = z.infer<typeof scheduleInputSchema>;
type CircleRow = Models.Row & { teamId: string; timezone: string };
type RecipientRow = Models.Row & { circleId: string };
type ScheduleRow = Models.Row & {
  circleId: string;
  recipientId: string;
  timezone: string;
  active: boolean;
};

export class ScheduleForbiddenError extends Error {
  constructor() {
    super("Only the circle owner can manage daily actions.");
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
  if (member.status !== "active" || member.role !== "owner") throw new ScheduleForbiddenError();
  return { databaseId, tables, circle };
}

export async function createSchedule(circleId: string, userId: string, input: ScheduleInput) {
  const { databaseId, tables, circle } = await ownerContext(circleId, userId);
  const recipients = await tables.listRows<RecipientRow>({
    databaseId,
    tableId: TABLES.recipients,
    queries: [Query.equal("circleId", [circleId]), Query.limit(1)],
    total: false,
  });
  const recipient = recipients.rows[0];
  if (!recipient) throw new Error("The care recipient no longer exists.");

  const schedule = await tables.createRow({
    databaseId,
    tableId: TABLES.schedules,
    rowId: ID.unique(),
    data: {
      circleId,
      recipientId: recipient.$id,
      title: input.title,
      instruction: input.instruction || null,
      localTime: input.localTime,
      timezone: circle.timezone,
      rrule: "FREQ=DAILY",
      active: input.active,
    },
    permissions: [Permission.read(Role.team(circle.teamId))],
  });

  if (input.active) await ensureTodayOccurrences(circleId);
  return schedule;
}

export async function updateSchedule(
  circleId: string,
  scheduleId: string,
  userId: string,
  input: ScheduleInput,
) {
  const { databaseId, tables, circle } = await ownerContext(circleId, userId);
  const schedule = await tables.getRow<ScheduleRow>({
    databaseId,
    tableId: TABLES.schedules,
    rowId: scheduleId,
  });
  if (schedule.circleId !== circleId) throw new ScheduleForbiddenError();

  const updated = await tables.updateRow({
    databaseId,
    tableId: TABLES.schedules,
    rowId: scheduleId,
    data: {
      title: input.title,
      instruction: input.instruction || null,
      localTime: input.localTime,
      active: input.active,
    },
  });

  if (input.active) {
    const occurrences = await tables.listRows<OccurrenceRow>({
      databaseId,
      tableId: TABLES.occurrences,
      queries: [Query.equal("scheduleId", [scheduleId]), Query.limit(100)],
      total: false,
    });
    const todayKey = localDateKey(new Date(), circle.timezone);
    const todayDue = occurrences.rows.find(
      (row) => row.status === "due" && localDateKey(new Date(row.dueAt), circle.timezone) === todayKey,
    );
    if (todayDue) {
      await tables.updateRow({
        databaseId,
        tableId: TABLES.occurrences,
        rowId: todayDue.$id,
        data: { dueAt: localTimeTodayAsUtc(input.localTime, circle.timezone) },
      });
    } else if (!occurrences.rows.some((row) => localDateKey(new Date(row.dueAt), circle.timezone) === todayKey)) {
      await ensureTodayOccurrences(circleId);
    }
  }

  return updated;
}

export function scheduleErrorStatus(error: unknown) {
  if (error instanceof ScheduleForbiddenError) return 403;
  if (error instanceof AppwriteException && error.code === 404) return 404;
  return 500;
}
