import { protectDemoAdministration } from "@/lib/demo/guard";
import "server-only";

import { ID } from "node-appwrite";

import { getSessionServices, type OneDosePrefs } from "@/lib/auth/session";

export async function ensurePrimaryTeam(secret: string, fallbackName: string) {
  const { account, teams } = getSessionServices(secret);
  const user = await account.get<OneDosePrefs>();
  if (user.prefs.primaryTeamId) return user;

  protectDemoAdministration(undefined,user.$id);
  const existing = await teams.list({ total: false });
  const team = existing.teams[0] ?? await teams.create({
    teamId: ID.unique(),
    name: `${fallbackName.trim() || "My"} care circle`,
    roles: ["owner", "caregiver"],
  });

  return account.updatePrefs<OneDosePrefs>({
    prefs: { ...user.prefs, primaryTeamId: team.$id },
  });
}
