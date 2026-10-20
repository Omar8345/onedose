import { clearSessionCookie, getSessionSecret, getSessionServices } from "@/lib/auth/session";

export async function POST() {
  const secret = await getSessionSecret();
  if (secret) {
    await getSessionServices(secret).account.deleteSession({ sessionId: "current" }).catch(() => undefined);
  }
  await clearSessionCookie();
  return Response.json({ ok: true });
}
