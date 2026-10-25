import { AppwriteException } from "node-appwrite";
import { z } from "zod";

import { requireCurrentUser } from "@/lib/auth/session";
import {
  createSchedules,
  scheduleErrorStatus,
  ScheduleForbiddenError,
  scheduleInputSchema,
} from "@/lib/data/manage-schedule";

export async function POST(request: Request) {
  try {
    const [input, { user }] = await Promise.all([
      request.json().then((value) => scheduleInputSchema.parse(value)),
      requireCurrentUser(),
    ]);
    const circleId = user.prefs.circleId;
    if (!circleId) return Response.json({ message: "Set up your care circle first." }, { status: 409 });
    const schedules = await createSchedules(circleId, user.$id, input);
    return Response.json({
      ok: true,
      scheduleId: schedules.length === 1 ? schedules[0].$id : undefined,
      scheduleIds: schedules.map((schedule) => schedule.$id),
    }, { status: 201 });
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
    console.error("Unable to create OneDose schedule", error);
    return Response.json({ message: "The daily action could not be created." }, { status: scheduleErrorStatus(error) });
  }
}
