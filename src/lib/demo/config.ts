export const DEMO_TARGET = {
  endpoint: "https://fra.cloud.appwrite.io/v1",
  projectId: "6ad61f280034f679d696",
  databaseId: "6ad61f7e003988501658",
} as const;
export const DEMO_TEAM = "demo_mitchell_team";
export const DEMO_CIRCLE = "demo_mitchell_circle";
export const DEMO_ACCOUNTS = {
  sarah: { id: "demo_mitchell_sarah", email: "sarah.mitchell@example.com", name: "Sarah Mitchell", role: "owner", relationship: "Daughter" },
  james: { id: "demo_mitchell_james", email: "james.mitchell@example.com", name: "James Mitchell", role: "caregiver", relationship: "Son" },
  emily: { id: "demo_mitchell_emily", email: "emily.carter@example.com", name: "Emily Carter", role: "caregiver", relationship: "Family friend" },
} as const;
export function assertDemoTarget(env: Record<string, string | undefined> = process.env) {
  if (env.NEXT_PUBLIC_APPWRITE_ENDPOINT !== DEMO_TARGET.endpoint
    || env.NEXT_PUBLIC_APPWRITE_PROJECT_ID !== DEMO_TARGET.projectId
    || env.NEXT_PUBLIC_APPWRITE_DATABASE_ID !== DEMO_TARGET.databaseId) {
    throw new Error("Demo operations are restricted to the approved OneDose project and database.");
  }
}
export function demoOrigin(env: Record<string, string | undefined> = process.env): string | null {
  if (env.ONEDOSE_DEMO_ENABLED !== "true") return null;
  try {
    assertDemoTarget(env);
    const origin = env.ONEDOSE_DEMO_ORIGIN;
    if (!["https://onedose.appwrite.network", "http://localhost:3000", "http://127.0.0.1:3000"].includes(origin ?? "")) return null;
    return origin!;
  } catch { return null; }
}
