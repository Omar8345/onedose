import { createHash } from "node:crypto";

import nextEnv from "@next/env";
import { AppwriteException, Client, TablesDB } from "node-appwrite";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const requiredEnv = [
  "NEXT_PUBLIC_APPWRITE_ENDPOINT",
  "NEXT_PUBLIC_APPWRITE_PROJECT_ID",
  "NEXT_PUBLIC_APPWRITE_DATABASE_ID",
  "APPWRITE_API_KEY",
];

const missing = requiredEnv.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Missing environment variables: ${missing.join(", ")}`);
  console.error("Copy .env.example to .env.local and add a server API key.");
  process.exit(1);
}

const databaseId = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID;
const client = new Client()
  .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT)
  .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID)
  .setKey(process.env.APPWRITE_API_KEY);
const tables = new TablesDB(client);

const ids = {
  circle: "demo_circle_nora",
  recipient: "demo_recipient_nora",
  schedule: "demo_schedule_midday",
  omar: "demo_omar",
  maya: "demo_maya",
  team: "demo_team",
};

function stableHash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function memberId(actorId) {
  return `mem_${stableHash(`${ids.circle}:${actorId}`).slice(0, 30)}`;
}

function dubaiOccurrence() {
  const dubaiNow = new Date(Date.now() + 4 * 60 * 60 * 1000);
  const year = dubaiNow.getUTCFullYear();
  const month = dubaiNow.getUTCMonth();
  const day = dubaiNow.getUTCDate();
  const dateKey = `${year}${String(month + 1).padStart(2, "0")}${String(day).padStart(2, "0")}`;

  return {
    id: `demo_occ_${dateKey}`,
    dueAt: new Date(Date.UTC(year, month, day, 8, 30)).toISOString(),
  };
}

function isMissing(error) {
  return error instanceof AppwriteException && error.code === 404;
}

function valuesMatch(key, existing, expected) {
  if (key.endsWith("At") && typeof existing === "string" && typeof expected === "string") {
    return Date.parse(existing) === Date.parse(expected);
  }

  return existing === expected;
}

function assertExpected(tableId, rowId, existing, expected, mutableKeys = []) {
  const mismatches = Object.entries(expected)
    .filter(([key]) => !mutableKeys.includes(key))
    .filter(([key, value]) => !valuesMatch(key, existing[key], value))
    .map(([key, value]) => `${key}: expected ${JSON.stringify(value)}, found ${JSON.stringify(existing[key])}`);

  if (mismatches.length) {
    throw new Error(
      `${tableId}/${rowId} already exists with different seed data:\n- ${mismatches.join("\n- ")}`,
    );
  }
}

async function ensureRow(tableId, rowId, data, options = {}) {
  try {
    const existing = await tables.getRow({ databaseId, tableId, rowId });
    assertExpected(tableId, rowId, existing, data, options.mutableKeys);
    console.log(`✓ ${tableId}/${rowId} already matches`);
    return existing;
  } catch (error) {
    if (!isMissing(error)) throw error;
  }

  const created = await tables.createRow({
    databaseId,
    tableId,
    rowId,
    data,
    permissions: [],
  });
  console.log(`+ created ${tableId}/${rowId}`);
  return created;
}

const occurrence = dubaiOccurrence();

console.log(`Seeding synthetic OneDose data in database ${databaseId}...`);

await ensureRow("care_circles", ids.circle, {
  name: "Nora’s care",
  teamId: ids.team,
  timezone: "Asia/Dubai",
});

await ensureRow("circle_members", memberId(ids.omar), {
  circleId: ids.circle,
  userId: ids.omar,
  role: "owner",
  status: "active",
});

await ensureRow("circle_members", memberId(ids.maya), {
  circleId: ids.circle,
  userId: ids.maya,
  role: "caregiver",
  status: "active",
});

await ensureRow("care_recipients", ids.recipient, {
  circleId: ids.circle,
  displayName: "Nora",
});

await ensureRow("schedules", ids.schedule, {
  circleId: ids.circle,
  recipientId: ids.recipient,
  title: "Midday routine",
  instruction: "Record the outcome once the routine is complete.",
  localTime: "12:30",
  timezone: "Asia/Dubai",
  rrule: "FREQ=DAILY",
  active: true,
});

await ensureRow("occurrences", occurrence.id, {
  circleId: ids.circle,
  teamId: ids.team,
  scheduleId: ids.schedule,
  dueAt: occurrence.dueAt,
  status: "due",
  version: 0,
}, { mutableKeys: ["status", "version"] });

console.log(`OneDose demo data is ready. Due occurrence: ${occurrence.id}`);
console.log("These rows are synthetic and server-only until Appwrite Auth and Teams onboarding is connected.");
