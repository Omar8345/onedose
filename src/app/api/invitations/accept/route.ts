import { AppwriteException } from "node-appwrite";
import { z } from "zod";

import {
  getPublicTeams,
  getSessionSecret,
} from "@/lib/auth/session";
import {
  activateTeamForSession,
  rememberPendingTeam,
} from "@/lib/auth/invitation";

const acceptanceSchema = z.object({
  teamId: z.string().min(1).max(36),
  membershipId: z.string().min(1).max(36),
  userId: z.string().min(1).max(36),
  secret: z.string().min(1).max(256),
});

export async function POST(request: Request) {
  try {
    const input = acceptanceSchema.parse(await request.json());
    const membership = await getPublicTeams().updateMembershipStatus(input);
    await rememberPendingTeam(input.teamId);

    const sessionSecret = await getSessionSecret();
    const signedIn = sessionSecret
      ? await activateTeamForSession(sessionSecret, input.teamId)
      : false;

    return Response.json({
      ok: true,
      signedIn,
      email: membership.userEmail,
      circleName: membership.teamName,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ message: "This invitation link is incomplete." }, { status: 400 });
    }
    if (error instanceof AppwriteException) {
      return Response.json(
        { message: "This invitation is invalid, expired, or already used." },
        { status: error.code === 401 ? 401 : 400 },
      );
    }
    console.error("Unable to accept OneDose invitation", error);
    return Response.json({ message: "The invitation could not be accepted." }, { status: 500 });
  }
}
