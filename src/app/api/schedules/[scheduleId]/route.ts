import { AppwriteException } from "node-appwrite";
import { z } from "zod";

import { requireCurrentUser } from "@/lib/auth/session";
import {
  archiveSchedule,
  scheduleErrorStatus,
  ScheduleForbiddenError,
  scheduleInputSchema,
  updateSchedule,
} from "@/lib/data/manage-schedule";

export async function DELETE(
  _request: Request,
  context: RouteContext<"/api/schedules/[scheduleId]">,
) {
  try {
    const [{ scheduleId }, { user }] = await Promise.all([context.params, requireCurrentUser()]);
    const circleId = user.prefs.circleId;
    if (!circleId) return Response.json({ message: "Set up your care circle first." }, { status: 409 });
    await archiveSchedule(circleId, scheduleId, user.$id);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof ScheduleForbiddenError) {
      return Response.json({ message: error.message }, { status: 403 });
    }
    if (error instanceof AppwriteException && error.code === 401) {
      return Response.json({ message: "Sign in again to manage schedules." }, { status: 401 });
    }
    console.error("Unable to remove OneDose schedule", error);
    return Response.json({ message: "The daily action could not be removed." }, { status: scheduleErrorStatus(error) });
  }
}

export async function PATCH(
  request: Request,
  context: RouteContext<"/api/schedules/[scheduleId]">,
) {
  try {
    const [{ scheduleId }, input, { user }] = await Promise.all([
      context.params,
      request.json().then((value) => scheduleInputSchema.parse(value)),
      requireCurrentUser(),
    ]);
    const circleId = user.prefs.circleId;
    if (!circleId) return Response.json({ message: "Set up your care circle first." }, { status: 409 });
    await updateSchedule(circleId, scheduleId, user.$id, input);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ message: "Check the action name, time, and schedule." }, { status: 400 });
    }
    if (error instanceof ScheduleForbiddenError) {
      return Response.json({ message: error.message }, { status: 403 });
    }
    if (error instanceof AppwriteException && error.code === 401) {
      return Response.json({ message: "Sign in again to manage schedules." }, { status: 401 });
    }
    console.error("Unable to update OneDose schedule", error);
    return Response.json({ message: "The daily action could not be updated." }, { status: scheduleErrorStatus(error) });
  }
}
