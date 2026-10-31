import { protectDemoAdministration } from "@/lib/demo/guard";
import { PublicDemoRestriction } from "@/lib/demo/guard";
import { AppwriteException } from "node-appwrite";
import { z } from "zod";

import { requireCurrentUser } from "@/lib/auth/session";
import { activatePendingTeam } from "@/lib/auth/invitation";

const profileSchema = z.object({ name: z.string().trim().min(2).max(80) });

export async function POST(request: Request) {
  try {
    const { name } = profileSchema.parse(await request.json());
    const { account, secret, user } = await requireCurrentUser();
    protectDemoAdministration(undefined,user.$id);
    const updatedUser = await account.updateName({ name });
    if (updatedUser.name !== name) throw new Error("Appwrite did not persist the profile name.");
    await activatePendingTeam(secret);
    return Response.json({ ok: true });
  } catch (error) {
    if(error instanceof PublicDemoRestriction)return Response.json({message:error.message},{status:403});
    if (error instanceof z.ZodError) return Response.json({ message: "Enter the name your care circle should see." }, { status: 400 });
    if (error instanceof AppwriteException && error.code === 401) return Response.json({ message: "Your code expired. Start again." }, { status: 401 });
    console.error("Unable to finish OneDose profile", error);
    return Response.json({ message: "Your profile could not be saved." }, { status: 500 });
  }
}
