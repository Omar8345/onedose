import { AppwriteException } from "node-appwrite";
import { connection } from "next/server";

import { getServerAppwrite } from "@/lib/appwrite/server";
import { requireCurrentUser } from "@/lib/auth/session";

const JWT_DURATION_SECONDS = 60 * 60;

export async function GET() {
  await connection();
  try {
    const { account, user } = await requireCurrentUser();
    const session = await account.getSession({ sessionId: "current" });
    const token = await getServerAppwrite().users.createJWT({
      userId: user.$id,
      sessionId: session.$id,
      duration: JWT_DURATION_SECONDS,
    });
    return Response.json({ jwt: token.jwt, expiresIn: JWT_DURATION_SECONDS });
  } catch (error) {
    if (error instanceof AppwriteException && error.code === 401) {
      return Response.json({ message: "Authentication required." }, { status: 401 });
    }
    console.error("Unable to create OneDose Realtime token", error);
    return Response.json({ message: "Live updates are temporarily unavailable." }, { status: 503 });
  }
}
