import { AppwriteException } from "node-appwrite";
import { z } from "zod";

import { requireCurrentUser } from "@/lib/auth/session";
import { createRecipient, recipientErrorStatus, recipientInputSchema } from "@/lib/data/manage-recipient";

export async function POST(request: Request) {
  try {
    const [input, { user }] = await Promise.all([
      request.json().then((value) => recipientInputSchema.parse(value)),
      requireCurrentUser(),
    ]);
    const circleId = user.prefs.circleId;
    if (!circleId) return Response.json({ message: "Set up your care circle first." }, { status: 409 });
    const recipient = await createRecipient(circleId, user.$id, input);
    return Response.json({ ok: true, recipientId: recipient.$id }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof RangeError) {
      return Response.json({ message: "Check the person’s name and time zone." }, { status: 400 });
    }
    if (error instanceof AppwriteException && error.code === 401) {
      return Response.json({ message: "Sign in again to manage care profiles." }, { status: 401 });
    }
    console.error("Unable to create OneDose recipient", error);
    return Response.json({ message: "The care profile could not be created." }, { status: recipientErrorStatus(error) });
  }
}
