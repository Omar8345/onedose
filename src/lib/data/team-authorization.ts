import "server-only";

import { AppwriteException, Query } from "node-appwrite";
import { getServerAppwrite } from "@/lib/appwrite/server";

export async function requireTeamMembership(teamId: string, userId: string, owner = false) {
  const { teams } = getServerAppwrite();
  const memberships = await teams.listMemberships({
    teamId, queries: [Query.equal("userId", [userId]), Query.limit(100)], total: false,
  });
  if (!memberships.memberships.some((member) => member.userId === userId && member.confirm
    && (!owner || member.roles.includes("owner")))) {
    throw new AppwriteException("You do not have the required confirmed Team membership.", 403, "onedose_forbidden");
  }
}
