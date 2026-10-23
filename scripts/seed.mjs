import { createHash } from "node:crypto";

import nextEnv from "@next/env";
import { AppwriteException, Client, Query, TablesDB, Teams } from "node-appwrite";

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
const teams = new Teams(client);

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

async function ensureOccurrence(rowId, data) {
  try {
    return await ensureRow("occurrences", rowId, data, { mutableKeys: ["status", "version"] });
  } catch (error) {
    if (!(error instanceof AppwriteException) || error.code !== 409) throw error;
    const existing = await tables.listRows({
      databaseId,
      tableId: "occurrences",
      queries: [Query.equal("scheduleId", [data.scheduleId]), Query.equal("dueAt", [data.dueAt]), Query.limit(1)],
      total: false,
    });
    if (!existing.rows[0]) throw error;
    assertExpected("occurrences", existing.rows[0].$id, existing.rows[0], data, ["status", "version"]);
    console.log(`✓ occurrences/${existing.rows[0].$id} already matches today's schedule`);
    return existing.rows[0];
  }
}

const occurrence = dubaiOccurrence();

console.log(`Seeding synthetic OneDose data in database ${databaseId}...`);

try {
  await teams.get({ teamId: ids.team });
  console.log(`✓ team/${ids.team} already matches`);
} catch (error) {
  if (!isMissing(error)) throw error;
  await teams.create({ teamId: ids.team, name: "Nora’s demo care", roles: ["owner", "caregiver"] });
  console.log(`+ created team/${ids.team}`);
}

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

await ensureRow("caregiver_preferences", `pref_${stableHash(`${ids.circle}:${ids.omar}`).slice(0, 30)}`, {
  circleId: ids.circle,
  userId: ids.omar,
  availability: "available",
  updatedAt: new Date().toISOString(),
}, { mutableKeys: ["availability", "updatedAt"] });

await ensureRow("caregiver_preferences", `pref_${stableHash(`${ids.circle}:${ids.maya}`).slice(0, 30)}`, {
  circleId: ids.circle,
  userId: ids.maya,
  availability: "available",
  updatedAt: new Date().toISOString(),
}, { mutableKeys: ["availability", "updatedAt"] });

await ensureRow("care_circle_settings", `set_${stableHash(ids.circle).slice(0, 30)}`, {
  circleId: ids.circle,
  primaryUserId: ids.omar,
  escalationMinutes: 60,
  updatedAt: new Date().toISOString(),
}, { mutableKeys: ["primaryUserId", "escalationMinutes", "updatedAt"] });

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

const seededOccurrence = await ensureOccurrence(occurrence.id, {
  circleId: ids.circle,
  teamId: ids.team,
  scheduleId: ids.schedule,
  dueAt: occurrence.dueAt,
  status: "due",
  version: 0,
});

console.log(`OneDose demo data is ready. Due occurrence: ${seededOccurrence.$id}`);
console.log("These rows are synthetic and server-only until Appwrite Auth and Teams onboarding is connected.");
