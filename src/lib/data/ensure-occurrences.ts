import "server-only";

import { AppwriteException, Permission, Query, Role, type Models } from "node-appwrite";

import { getServerAppwrite } from "@/lib/appwrite/server";
import { stableRowId } from "@/lib/domain/ids";
import { TABLES } from "@/lib/domain/schema";
import { localDateKey, localTimeTodayAsUtc } from "@/lib/domain/time";

type CircleRow = Models.Row & { teamId: string; timezone: string };
type ScheduleRow = Models.Row & {
  circleId: string;
  localTime: string;
  timezone: string;
  rrule: string;
  active: boolean;
  archivedAt: string | null;
};

export async function ensureTodayOccurrences(circleId: string, now = new Date()) {
  const { databaseId, tables } = getServerAppwrite();
  const [circle, schedules] = await Promise.all([
    tables.getRow<CircleRow>({ databaseId, tableId: TABLES.circles, rowId: circleId }),
    tables.listRows<ScheduleRow>({
      databaseId,
      tableId: TABLES.schedules,
      queries: [
        Query.equal("circleId", [circleId]),
        Query.equal("active", [true]),
        Query.isNull("archivedAt"),
        Query.limit(100),
      ],
      total: false,
    }),
  ]);

  await Promise.all(schedules.rows.map(async (schedule) => {
    if (schedule.rrule !== "FREQ=DAILY") return;
    const dueAt = localTimeTodayAsUtc(schedule.localTime, schedule.timezone, now);
    const dateKey = localDateKey(new Date(dueAt), schedule.timezone);
    const rowId = stableRowId("occ", `${schedule.$id}:${dateKey}`);

    try {
      await tables.createRow({
        databaseId,
        tableId: TABLES.occurrences,
        rowId,
        data: {
          circleId,
          teamId: circle.teamId,
          scheduleId: schedule.$id,
          dueAt,
          status: "due",
          outcome: null,
          completedBy: null,
          completedAt: null,
          activeEventId: null,
          claimedBy: null,
          claimedAt: null,
          claimExpiresAt: null,
          version: 0,
        },
        permissions: [Permission.read(Role.team(circle.teamId))],
      });
    } catch (error) {
      if (!(error instanceof AppwriteException && error.code === 409)) throw error;
    }
  }));
}
