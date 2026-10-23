import "server-only";

import { Client, TablesDB, Teams, Users } from "node-appwrite";
import { z } from "zod";

const serverEnvSchema = z.object({
  NEXT_PUBLIC_APPWRITE_ENDPOINT: z.url(),
  NEXT_PUBLIC_APPWRITE_PROJECT_ID: z.string().min(1),
  NEXT_PUBLIC_APPWRITE_DATABASE_ID: z.string().min(1),
  APPWRITE_API_KEY: z.string().min(1),
});

export function getServerAppwrite() {
  const env = serverEnvSchema.parse(process.env);
  const client = new Client()
    .setEndpoint(env.NEXT_PUBLIC_APPWRITE_ENDPOINT)
    .setProject(env.NEXT_PUBLIC_APPWRITE_PROJECT_ID)
    .setKey(env.APPWRITE_API_KEY);

  return {
    databaseId: env.NEXT_PUBLIC_APPWRITE_DATABASE_ID,
    tables: new TablesDB(client),
    teams: new Teams(client),
    users: new Users(client),
  };
}
