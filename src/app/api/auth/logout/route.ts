import { clearSessionCookie, getSessionSecret, getSessionServices } from "@/lib/auth/session";
import { revokeCurrentSession } from "@/lib/auth/revoke-session";

export async function POST() {
  const secret = await getSessionSecret();
  try {
    if (secret) await revokeCurrentSession(getSessionServices(secret).account);
  } catch {
    return Response.json({ message: "Sign out could not be confirmed. Please try again." },
      { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
  await clearSessionCookie();
  return Response.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
}
