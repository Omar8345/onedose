import { AppwriteException } from "node-appwrite";
import { z } from "zod";

import { requireCurrentUser } from "@/lib/auth/session";
import { createCareCircle, onboardingSchema } from "@/lib/data/create-care-circle";

export async function POST(request: Request) {
  try {
    const input = onboardingSchema.parse(await request.json());
    const { user, account } = await requireCurrentUser();
    const teamId = user.prefs.primaryTeamId;
    if (!teamId) return Response.json({ message: "Your private Team is not ready." }, { status: 409 });
    if (user.prefs.circleId) return Response.json({ ok: true, circleId: user.prefs.circleId });

    const circleId = await createCareCircle({ input, userId: user.$id, teamId, account });
    return Response.json({ ok: true, circleId }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof RangeError) {
      return Response.json({ message: "Check the care circle details and time zone." }, { status: 400 });
    }
    if (error instanceof AppwriteException && error.code === 401) {
      return Response.json({ message: "Sign in to create a care circle." }, { status: 401 });
    }
    console.error("Unable to create care circle", error);
    return Response.json({ message: "Your care circle could not be created." }, { status: 500 });
  }
}
