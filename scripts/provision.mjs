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

const varchar = (key, size, required = true, xdefault = undefined) => ({
  key,
  type: "varchar",
  size,
  required,
  ...(xdefault !== undefined ? { default: xdefault } : {}),
});
const datetime = (key, required = true) => ({ key, type: "datetime", required });
const enumeration = (key, elements, required = true) => ({
  key,
  type: "enum",
  elements,
  required,
});
const boolean = (key, required = true, xdefault = undefined) => ({
  key,
  type: "boolean",
  required,
  ...(xdefault !== undefined ? { default: xdefault } : {}),
});
const integer = (key, required = true, xdefault = undefined) => ({
  key,
  type: "integer",
  required,
  ...(xdefault !== undefined ? { default: xdefault } : {}),
});
const index = (key, type, attributes) => ({ key, type, attributes });

const outcomeValues = ["completed", "skipped", "refused", "unavailable"];

const schema = [
  {
    id: "care_circles",
    name: "Care circles",
    columns: [
      varchar("name", 100),
      varchar("teamId", 36),
      varchar("timezone", 64),
      datetime("archivedAt", false),
    ],
    indexes: [index("uniq_team", "unique", ["teamId"]), index("by_archive", "key", ["archivedAt"])],
  },
  {
    id: "circle_members",
    name: "Circle members",
    columns: [
      varchar("circleId", 36),
      varchar("userId", 36),
      enumeration("role", ["owner", "caregiver", "viewer"]),
      enumeration("status", ["active", "revoked"]),
      datetime("lastMutationAt", false),
    ],
    indexes: [
      index("uniq_circle_user", "unique", ["circleId", "userId"]),
      index("by_user_status", "key", ["userId", "status"]),
    ],
  },
  {
    id: "care_recipients",
    name: "Care recipients",
    columns: [varchar("circleId", 36), varchar("displayName", 100), datetime("archivedAt", false)],
    indexes: [index("by_circle_archive", "key", ["circleId", "archivedAt"])],
  },
  {
    id: "schedules",
    name: "Schedules",
    columns: [
      varchar("circleId", 36),
      varchar("recipientId", 36),
      varchar("title", 120),
      varchar("instruction", 500, false),
      varchar("localTime", 5),
      varchar("timezone", 64),
      varchar("rrule", 500),
      boolean("active"),
    ],
    indexes: [
      index("by_circle_active", "key", ["circleId", "active"]),
      index("by_recipient_active", "key", ["recipientId", "active"]),
    ],
  },
  {
    id: "occurrences",
    name: "Occurrences",
    columns: [
      varchar("circleId", 36),
      varchar("teamId", 36),
      varchar("scheduleId", 36),
      datetime("dueAt"),
      enumeration("status", ["due", ...outcomeValues]),
      enumeration("outcome", outcomeValues, false),
      varchar("completedBy", 36, false),
      datetime("completedAt", false),
      varchar("activeEventId", 36, false),
      integer("version"),
    ],
    indexes: [
      index("uniq_schedule_due", "unique", ["scheduleId", "dueAt"]),
      index("by_circle_status_due", "key", ["circleId", "status", "dueAt"]),
    ],
  },
  {
    id: "audit_events",
    name: "Audit events",
    columns: [
      varchar("circleId", 36),
      varchar("occurrenceId", 36),
      varchar("actorId", 36),
      enumeration("type", ["outcome_recorded", "outcome_corrected"]),
      enumeration("outcome", outcomeValues),
      varchar("note", 500, false),
      datetime("occurredAt"),
      datetime("recordedAt"),
      varchar("supersedesEventId", 36, false),
    ],
    indexes: [
      index("by_circle_recorded", "key", ["circleId", "recordedAt"]),
      index("by_occurrence_recorded", "key", ["occurrenceId", "recordedAt"]),
    ],
  },
  {
    id: "command_receipts",
    name: "Command receipts",
    columns: [
      varchar("occurrenceId", 36),
      varchar("actorId", 36),
      varchar("requestFingerprint", 64),
      enumeration("result", ["accepted"]),
      varchar("eventId", 36),
      datetime("completedAt"),
    ],
    indexes: [index("by_occurrence", "key", ["occurrenceId"]), index("by_actor", "key", ["actorId"])],
  },
  {
    id: "notification_deliveries",
    name: "Notification deliveries",
    columns: [
      varchar("circleId", 36),
      varchar("occurrenceId", 36),
      enumeration("kind", ["due", "overdue"]),
      enumeration("status", ["claimed", "sent", "failed", "dry_run"]),
      integer("recipientCount"),
      datetime("claimedAt"),
      datetime("sentAt", false),
      varchar("lastError", 500, false),
      varchar("messageId", 36),
    ],
    indexes: [
      index("uniq_occurrence_kind", "unique", ["occurrenceId", "kind"]),
      index("by_circle_claimed", "key", ["circleId", "claimedAt"]),
      index("by_status_claimed", "key", ["status", "claimedAt"]),
    ],
  },
];

function isMissing(error) {
  return error instanceof AppwriteException && error.code === 404;
}

async function findTable(tableId) {
  try {
    return await tables.getTable({ databaseId, tableId });
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

async function verifyExisting(definition) {
  const [columns, indexes] = await Promise.all([
    tables.listColumns({ databaseId, tableId: definition.id, total: false }),
    tables.listIndexes({ databaseId, tableId: definition.id, total: false }),
  ]);
  const columnKeys = new Set(columns.columns.map((column) => column.key));
  const indexKeys = new Set(indexes.indexes.map((item) => item.key));
  const missingColumns = definition.columns.filter((column) => !columnKeys.has(column.key));
  const missingIndexes = definition.indexes.filter((item) => !indexKeys.has(item.key));

  if (missingColumns.length || missingIndexes.length) {
    throw new Error(
      `Table ${definition.id} exists but is incomplete. Missing columns: ${missingColumns.map((item) => item.key).join(", ") || "none"}; missing indexes: ${missingIndexes.map((item) => item.key).join(", ") || "none"}.`,
    );
  }
}

console.log(`Provisioning ${schema.length} tables in database ${databaseId}...`);

for (const definition of schema) {
  const existing = await findTable(definition.id);
  if (existing) {
    await verifyExisting(definition);
    console.log(`✓ ${definition.id} already matches`);
    continue;
  }

  await tables.createTable({
    databaseId,
    tableId: definition.id,
    name: definition.name,
    permissions: [],
    rowSecurity: true,
    enabled: true,
    columns: definition.columns,
    indexes: definition.indexes,
  });
  console.log(`+ created ${definition.id}`);
}

console.log("OneDose TablesDB schema is ready.");
