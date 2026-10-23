import { AppwriteException } from "node-appwrite";
import { z } from "zod";

import {
  AlertSettingsForbiddenError,
  alertSettingsInputSchema,
  updateAlertSettings,
} from "@/lib/data/manage-alerts";

export async function PATCH(request: Request) {
  try {
    const input = alertSettingsInputSchema.parse(await request.json());
    const settings = await updateAlertSettings(input);
    return Response.json({ ok: true, primaryUserId: settings.primaryUserId, escalationMinutes: settings.escalationMinutes });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ message: "Choose a caregiver and a delay between 1 and 12 hours." }, { status: 400 });
    if (error instanceof AlertSettingsForbiddenError) return Response.json({ message: error.message }, { status: 403 });
    if (error instanceof AppwriteException && error.code === 401) return Response.json({ message: "Sign in again." }, { status: 401 });
    console.error("Unable to update OneDose alert settings", error);
    return Response.json({ message: "Alert settings could not be updated." }, { status: 500 });
  }
}
