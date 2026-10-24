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
    columns: [
      varchar("circleId", 36),
      varchar("displayName", 100),
      varchar("relationship", 80, false),
      varchar("careNotes", 1000, false),
      varchar("timezone", 64, false),
      datetime("archivedAt", false),
    ],
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
      datetime("archivedAt", false),
    ],
    indexes: [
      index("by_circle_active", "key", ["circleId", "active"]),
      index("by_recipient_active", "key", ["recipientId", "active"]),
      index("by_circle_archive", "key", ["circleId", "archivedAt"]),
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
      varchar("claimedBy", 36, false),
      datetime("claimedAt", false),
      datetime("claimExpiresAt", false),
      integer("version"),
    ],
    indexes: [
      index("uniq_schedule_due", "unique", ["scheduleId", "dueAt"]),
      index("by_circle_status_due", "key", ["circleId", "status", "dueAt"]),
      index("by_claim_expiry", "key", ["circleId", "claimExpiresAt"]),
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
    id: "occurrence_claims",
    name: "Occurrence claims",
    columns: [
      varchar("circleId", 36),
      varchar("occurrenceId", 36),
      varchar("actorId", 36),
      datetime("claimedAt"),
      datetime("expiresAt"),
    ],
    indexes: [
      index("uniq_occurrence", "unique", ["occurrenceId"]),
      index("by_circle_expiry", "key", ["circleId", "expiresAt"]),
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
  {
    id: "caregiver_preferences",
    name: "Caregiver preferences",
    columns: [
      varchar("circleId", 36),
      varchar("userId", 36),
      enumeration("availability", ["available", "unavailable"]),
      datetime("updatedAt"),
    ],
    indexes: [
      index("uniq_circle_user", "unique", ["circleId", "userId"]),
      index("by_circle_availability", "key", ["circleId", "availability"]),
    ],
  },
  {
    id: "care_circle_settings",
    name: "Care circle settings",
    columns: [
      varchar("circleId", 36),
      varchar("primaryUserId", 36),
      integer("escalationMinutes"),
      datetime("updatedAt"),
    ],
    indexes: [index("uniq_circle", "unique", ["circleId"])],
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

async function waitForColumn(tableId, key) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const column = await tables.getColumn({ databaseId, tableId, key });
    if (column.status === "available") return;
    if (column.status === "failed") throw new Error(`Column ${tableId}.${key} failed to create.`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for column ${tableId}.${key}.`);
}

async function createColumn(tableId, column) {
  const common = { databaseId, tableId, key: column.key, required: column.required };
  if (column.type === "varchar") {
    await tables.createVarcharColumn({ ...common, size: column.size, xdefault: column.default ?? null });
  } else if (column.type === "datetime") {
    await tables.createDatetimeColumn({ ...common, xdefault: column.default ?? null });
  } else if (column.type === "enum") {
    await tables.createEnumColumn({ ...common, elements: column.elements, xdefault: column.default ?? null });
  } else if (column.type === "boolean") {
    await tables.createBooleanColumn({ ...common, xdefault: column.default ?? null });
  } else if (column.type === "integer") {
    await tables.createIntegerColumn({ ...common, xdefault: column.default ?? null });
  } else {
    throw new Error(`Unsupported migration column type: ${column.type}`);
  }
  await waitForColumn(tableId, column.key);
  console.log(`+ added ${tableId}.${column.key}`);
}

async function reconcileExisting(definition) {
  const [columns, indexes] = await Promise.all([
    tables.listColumns({ databaseId, tableId: definition.id, total: false }),
    tables.listIndexes({ databaseId, tableId: definition.id, total: false }),
  ]);
  const columnKeys = new Set(columns.columns.map((column) => column.key));
  const indexKeys = new Set(indexes.indexes.map((item) => item.key));
  const missingColumns = definition.columns.filter((column) => !columnKeys.has(column.key));
  const missingIndexes = definition.indexes.filter((item) => !indexKeys.has(item.key));

  for (const column of missingColumns) {
    await createColumn(definition.id, column);
  }
  for (const item of missingIndexes) {
    await tables.createIndex({
      databaseId,
      tableId: definition.id,
      key: item.key,
      type: item.type,
      columns: item.attributes,
    });
    console.log(`+ added ${definition.id}.${item.key}`);
  }
}

console.log(`Provisioning ${schema.length} tables in database ${databaseId}...`);

for (const definition of schema) {
  const existing = await findTable(definition.id);
  if (existing) {
    await reconcileExisting(definition);
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
