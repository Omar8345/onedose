import { isDemoOtpIdentity } from "@/lib/demo/guard";
import { PublicDemoRestriction } from "@/lib/demo/guard";
import { AppwriteException } from "node-appwrite";
import { z } from "zod";

import { getAdminAccount, getSessionServices, setSessionCookie } from "@/lib/auth/session";
import { activatePendingTeam, getPendingTeam } from "@/lib/auth/invitation";
import { ensureEmailTarget } from "@/lib/auth/messaging-target";
import { ensurePrimaryTeam } from "@/lib/auth/team";

const verifySchema = z.object({
  userId: z.string().min(1).max(36),
  secret: z.string().trim().min(6).max(128),
});

export async function POST(request: Request) {
  try {
    const input = verifySchema.parse(await request.json());
    if(await isDemoOtpIdentity({userId:input.userId}))return Response.json({message:"Use the named demo-account buttons to sign in."},{status:403});
    const session = await getAdminAccount().createSession({ userId: input.userId, secret: input.secret });
    const account = getSessionServices(session.secret).account;
    const user = await account.get();
    await setSessionCookie(session);
    try {
      await ensureEmailTarget(user.$id, user.email);
    } catch (error) {
    if(error instanceof PublicDemoRestriction)return Response.json({message:error.message},{status:403});
      // A notification setup problem must not invalidate a successful sign-in.
      console.error("Unable to ensure OneDose email target", error);
    }
    const pendingTeam = await getPendingTeam();
    if (!user.name || pendingTeam) return Response.json({ ok: true, needsProfile: true });
    const joinedInvitation = await activatePendingTeam(session.secret);
    if (!joinedInvitation) await ensurePrimaryTeam(session.secret, user.name);
    return Response.json({ ok: true, needsProfile: false });
  } catch (error) {
    if(error instanceof PublicDemoRestriction)return Response.json({message:error.message},{status:403});
    if (error instanceof z.ZodError) return Response.json({ message: "Enter the six-digit code." }, { status: 400 });
    if (error instanceof AppwriteException) return Response.json({ message: "That code is incorrect or has expired." }, { status: 401 });
    console.error("Unable to verify OneDose email code", error);
    return Response.json({ message: "The code could not be verified." }, { status: 500 });
  }
}
