import "server-only";

import { Query, type Models } from "node-appwrite";

import { getServerAppwrite } from "@/lib/appwrite/server";
import { materializeSchedule } from "../../../functions/reminders/src/schedule-lifecycle.js";
import { TABLES } from "@/lib/domain/schema";

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

  const results = await Promise.allSettled(schedules.rows.map(schedule =>
    materializeSchedule(tables, databaseId, circle, schedule, now)));
  for (const result of results) if (result.status === "rejected") throw result.reason;
}
