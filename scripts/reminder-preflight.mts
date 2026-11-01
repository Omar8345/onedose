// Read-only deployment gate. No update, execution, or permission-changing API calls.
import nextEnv from "@next/env";
import { Client, Functions } from "node-appwrite";
import { readFileSync } from "node:fs";
nextEnv.loadEnvConfig(process.cwd());
const plan = JSON.parse(readFileSync(new URL("../functions/reminders/permission-plan.json", import.meta.url), "utf8"));
if (process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID !== plan.projectId || process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT !== "https://fra.cloud.appwrite.io/v1") {
  throw new Error("Reminder preflight target mismatch; refusing even a configuration lookup.");
}
if (!process.env.APPWRITE_API_KEY) throw new Error("Reminder preflight requires a server key with Function read access.");
const client = new Client().setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT).setProject(plan.projectId).setKey(process.env.APPWRITE_API_KEY);
const fn = await new Functions(client).get({ functionId: plan.functionId });
const aliases = new Set(["documentsdb.documents.read", "documentsdb.documents.write", "vectorsdb.documents.read", "vectorsdb.documents.write"]);
const allowed = new Set([...plan.scopes, ...aliases]);
const blockers: string[] = [];
if (fn.execute.length) blockers.push("Client execute access must be empty; an operator must separately approve and apply the prepared permission plan.");
for (const scope of plan.scopes) if (!fn.scopes.includes(scope)) blockers.push(`Missing required runtime capability: ${scope}`);
for (const scope of fn.scopes) if (!allowed.has(scope)) blockers.push(`Unused runtime scope must be removed: ${scope}`);
console.log(JSON.stringify({ functionId: fn.$id, execute: fn.execute, effectiveScopes: fn.scopes,
  compatibilityAliases: fn.scopes.filter(scope => aliases.has(scope)), schedule: fn.schedule, events: fn.events,
  permissionGateReady: blockers.length === 0, blockers,
  operatorCheck: "Confirm any document/vector scope entries are automatic aliases of the selected row scopes, not independent grants." }, null, 2));
if (blockers.length) process.exitCode = 2;
