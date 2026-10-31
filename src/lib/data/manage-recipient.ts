import { protectDemoAdministration } from "@/lib/demo/guard";
import "server-only";

import { AppwriteException, ID, Permission, Query, Role, type Models } from "node-appwrite";
import { z } from "zod";

import { getServerAppwrite } from "@/lib/appwrite/server";
import { stableRowId } from "@/lib/domain/ids";
import { TABLES, type CareRecipientRow, type MemberRow } from "@/lib/domain/schema";

export const recipientInputSchema = z.object({
  displayName: z.string().trim().min(2).max(100),
  relationship: z.string().trim().max(80).optional(),
  careNotes: z.string().trim().max(1000).optional(),
  timezone: z.string().trim().min(1).max(64),
});

type RecipientInput = z.infer<typeof recipientInputSchema>;
type CircleRow = Models.Row & { teamId: string };
type ScheduleRow = Models.Row & { localTime: string; timezone: string; archivedAt: string | null };

export class RecipientForbiddenError extends Error {
  constructor() {
    super("Only the circle owner can manage care profiles.");
    this.name = "RecipientForbiddenError";
  }
}

export class RecipientInUseError extends Error {
  constructor() {
    super("Move or remove this person’s care actions before archiving their profile.");
    this.name = "RecipientInUseError";
  }
}

async function ownerContext(circleId: string, userId: string) {
  protectDemoAdministration(circleId,userId);
  const { databaseId, tables } = getServerAppwrite();
  const [circle, member] = await Promise.all([
    tables.getRow<CircleRow>({ databaseId, tableId: TABLES.circles, rowId: circleId }),
    tables.getRow<MemberRow>({ databaseId, tableId: TABLES.members, rowId: stableRowId("mem", `${circleId}:${userId}`) }),
  ]);
  if (member.status !== "active" || member.role !== "owner") throw new RecipientForbiddenError();
  return { databaseId, tables, circle };
}

function validateTimezone(timezone: string) {
  new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
}

export async function createRecipient(circleId: string, userId: string, input: RecipientInput) {
  validateTimezone(input.timezone);
  const { databaseId, tables, circle } = await ownerContext(circleId, userId);
  return tables.createRow<CareRecipientRow>({
    databaseId,
    tableId: TABLES.recipients,
    rowId: ID.unique(),
    data: {
      circleId,
      displayName: input.displayName,
      relationship: input.relationship || null,
      careNotes: input.careNotes || null,
      timezone: input.timezone,
      archivedAt: null,
    },
    permissions: [Permission.read(Role.team(circle.teamId))],
  });
}

export async function updateRecipient(circleId: string, recipientId: string, userId: string, input: RecipientInput) {
  validateTimezone(input.timezone);
  const { databaseId, tables } = await ownerContext(circleId, userId);
  const recipient = await tables.getRow<CareRecipientRow>({ databaseId, tableId: TABLES.recipients, rowId: recipientId });
  if (recipient.circleId !== circleId || recipient.archivedAt) throw new RecipientForbiddenError();
  const updated = await tables.updateRow<CareRecipientRow>({
    databaseId,
    tableId: TABLES.recipients,
    rowId: recipientId,
    data: {
      displayName: input.displayName,
      relationship: input.relationship || null,
      careNotes: input.careNotes || null,
      timezone: input.timezone,
    },
  });
  if (recipient.timezone !== input.timezone) {
    const schedules = await tables.listRows<ScheduleRow>({
      databaseId,
      tableId: TABLES.schedules,
      queries: [Query.equal("recipientId", [recipientId]), Query.isNull("archivedAt"), Query.limit(100)],
      total: false,
    });
    await Promise.all(schedules.rows.map((schedule) => tables.updateRow({
      databaseId,
      tableId: TABLES.schedules,
      rowId: schedule.$id,
      data: { timezone: input.timezone },
    })));
  }
  return updated;
}

export async function archiveRecipient(circleId: string, recipientId: string, userId: string) {
  const { databaseId, tables } = await ownerContext(circleId, userId);
  const recipient = await tables.getRow<CareRecipientRow>({ databaseId, tableId: TABLES.recipients, rowId: recipientId });
  if (recipient.circleId !== circleId) throw new RecipientForbiddenError();
  if (recipient.archivedAt) return recipient;
  const schedules = await tables.listRows({
    databaseId,
    tableId: TABLES.schedules,
    queries: [Query.equal("recipientId", [recipientId]), Query.isNull("archivedAt"), Query.limit(1)],
    total: false,
  });
  if (schedules.rows.length) throw new RecipientInUseError();
  return tables.updateRow<CareRecipientRow>({
    databaseId,
    tableId: TABLES.recipients,
    rowId: recipientId,
    data: { archivedAt: new Date().toISOString() },
  });
}

export function recipientErrorStatus(error: unknown) {
  if (error instanceof RecipientForbiddenError) return 403;
  if (error instanceof RecipientInUseError) return 409;
  if (error instanceof AppwriteException && error.code === 404) return 404;
  return 500;
}
