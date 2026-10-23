import { AppwriteException } from "node-appwrite";
import { z } from "zod";

import {
  AlertSettingsForbiddenError,
  availabilityInputSchema,
  updateMyAvailability,
} from "@/lib/data/manage-alerts";

export async function PATCH(request: Request) {
  try {
    const input = availabilityInputSchema.parse(await request.json());
    const preference = await updateMyAvailability(input);
    return Response.json({ ok: true, availability: preference.availability });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ message: "Choose a valid availability." }, { status: 400 });
    if (error instanceof AlertSettingsForbiddenError) return Response.json({ message: error.message }, { status: 403 });
    if (error instanceof AppwriteException && error.code === 401) return Response.json({ message: "Sign in again." }, { status: 401 });
    console.error("Unable to update OneDose availability", error);
    return Response.json({ message: "Availability could not be updated." }, { status: 500 });
  }
}
