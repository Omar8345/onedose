import { AppwriteException } from "node-appwrite";
import { z } from "zod";

import { getAdminAccount, getSessionServices, setSessionCookie } from "@/lib/auth/session";
import { ensurePrimaryTeam } from "@/lib/auth/team";

const verifySchema = z.object({
  userId: z.string().min(1).max(36),
  secret: z.string().trim().min(6).max(128),
  name: z.string().trim().min(2).max(80),
});

export async function POST(request: Request) {
  try {
    const input = verifySchema.parse(await request.json());
    const session = await getAdminAccount().createSession({ userId: input.userId, secret: input.secret });
    const account = getSessionServices(session.secret).account;
    const user = await account.get();
    if (!user.name) await account.updateName({ name: input.name });
    await ensurePrimaryTeam(session.secret, user.name || input.name);
    await setSessionCookie(session);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ message: "Enter your name and the six-digit code." }, { status: 400 });
    if (error instanceof AppwriteException) return Response.json({ message: "That code is incorrect or has expired." }, { status: 401 });
    console.error("Unable to verify OneDose email code", error);
    return Response.json({ message: "The code could not be verified." }, { status: 500 });
  }
}
