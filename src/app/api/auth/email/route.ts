import { isDemoOtpIdentity } from "@/lib/demo/guard";
import { PublicDemoRestriction } from "@/lib/demo/guard";
import { AppwriteException, ID } from "node-appwrite";
import { z } from "zod";

import { getPublicAccount } from "@/lib/auth/session";

const emailSchema = z.object({ email: z.email() });

export async function POST(request: Request) {
  try {
    const { email } = emailSchema.parse(await request.json());
    if(await isDemoOtpIdentity({email}))return Response.json({message:"Use the named demo-account buttons to sign in."},{status:403});
    const token = await getPublicAccount().createEmailToken({ userId: ID.unique(), email, phrase: false });
    return Response.json({ ok: true, userId: token.userId });
  } catch (error) {
    if(error instanceof PublicDemoRestriction)return Response.json({message:error.message},{status:403});
    if (error instanceof z.ZodError) return Response.json({ message: "Enter a valid email address." }, { status: 400 });
    if (error instanceof AppwriteException) return Response.json({ message: "A sign-in code could not be sent. Please try again." }, { status: error.code === 429 ? 429 : 400 });
    console.error("Unable to send OneDose email code", error);
    return Response.json({ message: "A sign-in code could not be sent." }, { status: 500 });
  }
}
