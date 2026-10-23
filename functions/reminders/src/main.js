import { Client, Messaging, TablesDB, Teams } from "node-appwrite";

import { runReminderSweep } from "./engine.js";

export default async function reminderHandler({ req, res, log, error }) {
  const databaseId = process.env.DATABASE_ID;
  const endpoint = process.env.APPWRITE_FUNCTION_API_ENDPOINT;
  const projectId = process.env.APPWRITE_FUNCTION_PROJECT_ID;
  const apiKey = req.headers["x-appwrite-key"];

  if (!databaseId || !endpoint || !projectId || !apiKey) {
    error("Missing DATABASE_ID or Appwrite function runtime credentials.");
    return res.json({ ok: false, message: "Function configuration is incomplete." }, 500);
  }

  const client = new Client()
    .setEndpoint(endpoint)
    .setProject(projectId)
    .setKey(apiKey);

  try {
    const summary = await runReminderSweep({
      tables: new TablesDB(client),
      messaging: new Messaging(client),
      teams: new Teams(client),
      databaseId,
      overdueMinutes: Number(process.env.OVERDUE_MINUTES || 60),
      appUrl: process.env.APP_URL || "https://onedose.appwrite.network",
      dryRun: process.env.REMINDER_DRY_RUN === "true",
    });
    log(`OneDose reminder sweep: ${JSON.stringify(summary)}`);
    return res.json({ ok: true, ...summary });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Unknown reminder error";
    error(`OneDose reminder sweep failed: ${message}`);
    return res.json({ ok: false, message: "Reminder sweep failed." }, 500);
  }
}
