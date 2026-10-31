import { validDemoActor } from "@/lib/demo/access";
import { takeDemoLoginSlot } from "@/lib/demo/rate-limit";
import { Query } from "node-appwrite";
import { z } from "zod";
import { getServerAppwrite } from "@/lib/appwrite/server";
import { setSessionCookie } from "@/lib/auth/session";
import { stableRowId } from "@/lib/domain/ids";
import { TABLES, type MemberRow } from "@/lib/domain/schema";
import { DEMO_ACCOUNTS, DEMO_CIRCLE, DEMO_TEAM, demoOrigin } from "@/lib/demo/config";

const selection = z.object({ account: z.enum(["sarah", "james", "emily"]) }).strict();

export async function GET() {
  return Response.json({ enabled: Boolean(demoOrigin()) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const origin = demoOrigin();
  if (!origin) return Response.json({ message: "Demo access is unavailable." }, { status: 404 });
  if (request.headers.get("origin") !== origin) {
    return Response.json({ message: "Open demo access from OneDose." }, { status: 403 });
  }
  try {
    if (!takeDemoLoginSlot()) return Response.json({ message: "Demo access is busy. Please try again in a minute." }, { status: 429, headers: { "Retry-After": "60" } });
    const parsed = selection.safeParse(await request.json());
    if (!parsed.success) return Response.json({ message: "Choose one of the three demo caregivers." }, { status: 400 });
    const actor = DEMO_ACCOUNTS[parsed.data.account];
    const { databaseId, users, tables, teams } = getServerAppwrite();
    const [user, member, memberships] = await Promise.all([
      users.get({ userId: actor.id }),
      tables.getRow<MemberRow>({ databaseId, tableId: TABLES.members, rowId: stableRowId("mem", `${DEMO_CIRCLE}:${actor.id}`) }),
      teams.listMemberships({ teamId: DEMO_TEAM, queries: [Query.equal("userId", [actor.id])] }),
    ]);
    if (!validDemoActor(actor, user, member, memberships.memberships)) {
      return Response.json({ message: "This demo caregiver is unavailable." }, { status: 403 });
    }
    const session = await users.createSession({ userId: actor.id });
    try { await setSessionCookie(session); }
    catch (error) { await users.deleteSession({ userId: actor.id, sessionId: session.$id }); throw error; }
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    // SDK error bodies can contain sensitive authentication metadata. Never log them.
    return Response.json({ message: "Demo sign-in is unavailable. Please try again later." }, { status: 503 });
  }
}
