import { AppwriteException, Query } from "node-appwrite";
import { z } from "zod";

import { requireCurrentUser } from "@/lib/auth/session";
import { getServerAppwrite } from "@/lib/appwrite/server";
import { stableRowId } from "@/lib/domain/ids";
import { TABLES, type MemberRow } from "@/lib/domain/schema";

const inviteSchema = z.object({ email: z.email() });

export async function POST(request: Request) {
  try {
    const { email } = inviteSchema.parse(await request.json());
    const { user, teams } = await requireCurrentUser();
    if (email.trim().toLowerCase() === user.email.trim().toLowerCase()) {
      return Response.json({ message: "You cannot invite yourself to this care circle." }, { status: 400 });
    }
    const teamId = user.prefs.primaryTeamId;
    const circleId = user.prefs.circleId;
    if (!teamId || !circleId) {
      return Response.json({ message: "Finish setting up your care circle first." }, { status: 409 });
    }

    const { databaseId, tables, teams: adminTeams } = getServerAppwrite();
    const owner = await tables.getRow<MemberRow>({
      databaseId,
      tableId: TABLES.members,
      rowId: stableRowId("mem", `${circleId}:${user.$id}`),
    });
    if (owner.status !== "active" || owner.role !== "owner") {
      return Response.json({ message: "Only the circle owner can invite caregivers." }, { status: 403 });
    }

    const normalizedEmail = email.trim().toLowerCase();
    let memberships;
    try {
      memberships = await adminTeams.listMemberships({
        teamId,
        queries: [Query.limit(100)],
        total: false,
      });
    } catch (error) {
      if (error instanceof AppwriteException && error.code === 401) {
        console.error("Unable to inspect invitation memberships with the server API key", {
          code: error.code,
          message: error.message,
          type: error.type,
        });
        return Response.json({
          message: "Invitation duplicate checking is not configured. Grant the server API key permission to read Team memberships.",
        }, { status: 503 });
      }
      throw error;
    }
    const existingMembership = memberships.memberships.find(
      (membership) => membership.userEmail?.trim().toLowerCase() === normalizedEmail,
    );
    if (existingMembership) {
      return Response.json({
        message: existingMembership.confirm
          ? "This caregiver is already part of your care circle."
          : "This caregiver already has an invitation to your care circle.",
      }, { status: 409 });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || new URL(request.url).origin;
    let redirectUrl: string;
    try {
      redirectUrl = new URL("/invite", appUrl).toString();
    } catch {
      return Response.json({
        message: "Invitation setup is incomplete. Set NEXT_PUBLIC_APP_URL to the app's public URL.",
      }, { status: 500 });
    }
    const membership = await teams.createMembership({
      teamId,
      roles: ["caregiver"],
      email,
      url: redirectUrl,
      membershipId: stableRowId("inv", `${teamId}:${normalizedEmail}`),
    });

    return Response.json({ ok: true, membershipId: membership.$id }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ message: "Enter a valid caregiver email address." }, { status: 400 });
    }
    if (error instanceof AppwriteException) {
      console.error("Unable to create Appwrite invitation", {
        code: error.code,
        message: error.message,
        type: error.type,
      });
      const appwriteMessage = error.message.toLowerCase();
      const message = error.code === 409
        ? "That caregiver already has an invitation to this circle."
        : error.code === 401
          ? "Your sign-in session has expired. Please sign in again."
          : appwriteMessage.includes("smtp") || appwriteMessage.includes("email provider")
            ? "Email delivery is not configured. Please contact the administrator."
            : appwriteMessage.includes("redirect") || appwriteMessage.includes("url")
            ? "The invitation link could not be created. Please check the app's configured domain."
          : "The invitation could not be sent. Please try again.";
      return Response.json({ message }, { status: error.code === 409 ? 409 : error.code === 401 ? 401 : 400 });
    }
    console.error("Unable to invite OneDose caregiver", error);
    return Response.json({ message: "The invitation could not be sent." }, { status: 500 });
  }
}
