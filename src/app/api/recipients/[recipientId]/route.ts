import { PublicDemoRestriction } from "@/lib/demo/guard";
import { AppwriteException } from "node-appwrite";
import { z } from "zod";

import { requireCurrentUser } from "@/lib/auth/session";
import { archiveRecipient, recipientErrorStatus, recipientInputSchema, updateRecipient } from "@/lib/data/manage-recipient";

export async function PATCH(request: Request, context: RouteContext<"/api/recipients/[recipientId]">) {
  try {
    const [{ recipientId }, input, { user }] = await Promise.all([
      context.params,
      request.json().then((value) => recipientInputSchema.parse(value)),
      requireCurrentUser(),
    ]);
    const circleId = user.prefs.circleId;
    if (!circleId) return Response.json({ message: "Set up your care circle first." }, { status: 409 });
    await updateRecipient(circleId, recipientId, user.$id, input);
    return Response.json({ ok: true });
  } catch (error) {
    if(error instanceof PublicDemoRestriction)return Response.json({message:error.message},{status:403});
    if (error instanceof z.ZodError || error instanceof RangeError) {
      return Response.json({ message: "Check the person’s name and time zone." }, { status: 400 });
    }
    if (error instanceof AppwriteException && error.code === 401) {
      return Response.json({ message: "Sign in again to manage care profiles." }, { status: 401 });
    }
    console.error("Unable to update OneDose recipient", error);
    return Response.json({ message: error instanceof Error ? error.message : "The care profile could not be updated." }, { status: recipientErrorStatus(error) });
  }
}

export async function DELETE(_request: Request, context: RouteContext<"/api/recipients/[recipientId]">) {
  try {
    const [{ recipientId }, { user }] = await Promise.all([context.params, requireCurrentUser()]);
    const circleId = user.prefs.circleId;
    if (!circleId) return Response.json({ message: "Set up your care circle first." }, { status: 409 });
    await archiveRecipient(circleId, recipientId, user.$id);
    return Response.json({ ok: true });
  } catch (error) {
    if(error instanceof PublicDemoRestriction)return Response.json({message:error.message},{status:403});
    if (error instanceof AppwriteException && error.code === 401) {
      return Response.json({ message: "Sign in again to manage care profiles." }, { status: 401 });
    }
    console.error("Unable to archive OneDose recipient", error);
    return Response.json({ message: error instanceof Error ? error.message : "The care profile could not be archived." }, { status: recipientErrorStatus(error) });
  }
}
