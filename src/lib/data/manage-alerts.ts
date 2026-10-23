import "server-only";

import { AppwriteException, Permission, Query, Role, type Models } from "node-appwrite";
import { z } from "zod";

import { getServerAppwrite } from "@/lib/appwrite/server";
import { requireCurrentUser } from "@/lib/auth/session";
import { stableRowId } from "@/lib/domain/ids";
import {
  TABLES,
  type CaregiverPreferenceRow,
  type CircleSettingsRow,
  type MemberRow,
} from "@/lib/domain/schema";

export const availabilityInputSchema = z.object({
  availability: z.enum(["available", "unavailable"]),
});

export const alertSettingsInputSchema = z.object({
  primaryUserId: z.string().min(1).max(36),
  escalationMinutes: z.number().int().min(60).max(720),
});

type CircleRow = Models.Row & { teamId: string };

export class AlertSettingsForbiddenError extends Error {
  constructor(message = "You cannot change these alert settings.") {
    super(message);
    this.name = "AlertSettingsForbiddenError";
  }
}

function isMissing(error: unknown) {
  return error instanceof AppwriteException && error.code === 404;
}

async function contextForCurrentUser() {
  const { user, teams: sessionTeams } = await requireCurrentUser();
  const circleId = user.prefs.circleId;
  if (!circleId) throw new AlertSettingsForbiddenError("Set up your care circle first.");
  const { databaseId, tables } = getServerAppwrite();
  const [circle, member] = await Promise.all([
    tables.getRow<CircleRow>({ databaseId, tableId: TABLES.circles, rowId: circleId }),
    tables.getRow<MemberRow>({
      databaseId,
      tableId: TABLES.members,
      rowId: stableRowId("mem", `${circleId}:${user.$id}`),
    }),
  ]);
  await sessionTeams.get({ teamId: circle.teamId });
  if (member.circleId !== circleId || member.userId !== user.$id || member.status !== "active") {
    throw new AlertSettingsForbiddenError("Your caregiver access is no longer active.");
  }
  return { user, circleId, circle, member, databaseId, tables };
}

export async function updateMyAvailability(input: z.infer<typeof availabilityInputSchema>) {
  const { user, circleId, circle, databaseId, tables } = await contextForCurrentUser();
  const rowId = stableRowId("pref", `${circleId}:${user.$id}`);
  const data = { circleId, userId: user.$id, availability: input.availability, updatedAt: new Date().toISOString() };
  try {
    return await tables.updateRow<CaregiverPreferenceRow>({
      databaseId, tableId: TABLES.caregiverPreferences, rowId, data,
    });
  } catch (error) {
    if (!isMissing(error)) throw error;
    return tables.createRow<CaregiverPreferenceRow>({
      databaseId,
      tableId: TABLES.caregiverPreferences,
      rowId,
      data,
      permissions: [Permission.read(Role.team(circle.teamId))],
    });
  }
}

export async function updateAlertSettings(input: z.infer<typeof alertSettingsInputSchema>) {
  const { circleId, circle, member, databaseId, tables } = await contextForCurrentUser();
  if (member.role !== "owner") throw new AlertSettingsForbiddenError("Only the owner can change escalation rules.");
  const primary = await tables.listRows<MemberRow>({
    databaseId,
    tableId: TABLES.members,
    queries: [
      Query.equal("circleId", [circleId]),
      Query.equal("userId", [input.primaryUserId]),
      Query.equal("status", ["active"]),
      Query.limit(1),
    ],
    total: false,
  });
  if (!primary.rows.length) throw new AlertSettingsForbiddenError("Choose an active caregiver as the first contact.");

  const rowId = stableRowId("set", circleId);
  const data = { circleId, ...input, updatedAt: new Date().toISOString() };
  try {
    return await tables.updateRow<CircleSettingsRow>({
      databaseId, tableId: TABLES.circleSettings, rowId, data,
    });
  } catch (error) {
    if (!isMissing(error)) throw error;
    return tables.createRow<CircleSettingsRow>({
      databaseId,
      tableId: TABLES.circleSettings,
      rowId,
      data,
      permissions: [Permission.read(Role.team(circle.teamId))],
    });
  }
}
