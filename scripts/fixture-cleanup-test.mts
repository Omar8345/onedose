import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd());
const [{ integrationFixture }, { getServerAppwrite }, { stableRowId }, { TABLES }] = await Promise.all([
  import("./integration-fixture"), import("../src/lib/appwrite/server"), import("../src/lib/domain/ids"), import("../src/lib/domain/schema"),
]);
const target = await integrationFixture("schedule");
const control = await integrationFixture("recipient");
const { users, teams } = getServerAppwrite();
const userId = `uncertain_${randomBytes(8).toString("hex")}`;
let createdUser = false;
try {
  await users.create({ userId, email: `${userId}@example.invalid`, name: "Synthetic uncertain fixture" });
  createdUser = true;
  const circle = await target.tables.getRow({ databaseId: target.databaseId, tableId: TABLES.circles, rowId: target.circleId });
  await teams.createMembership({ teamId: String(circle.teamId), userId, roles: ["caregiver"] });
  const rowId = stableRowId("mem", `${target.circleId}:${userId}`);
  const uncertainty = new Error("Simulated lost creation response");
  await assert.rejects(async () => {
    await target.tables.createRow({ databaseId: target.databaseId, tableId: TABLES.members, rowId,
      data: { circleId: target.circleId, userId, role: "caregiver", status: "active", lastMutationAt: null }, permissions: [] });
    throw uncertainty; // The fixture deliberately never records this row's ID.
  }, (error) => error === uncertainty);
  const controlId = stableRowId("mem", `${control.circleId}:${control.ownerId}`);
  const before = await control.tables.getRow({ databaseId: control.databaseId, tableId: TABLES.members, rowId: controlId });
  await target.cleanup();
  await assert.rejects(target.tables.getRow({ databaseId: target.databaseId, tableId: TABLES.members, rowId }), (error: unknown) => (error as { code?: number }).code === 404);
  const after = await control.tables.getRow({ databaseId: control.databaseId, tableId: TABLES.members, rowId: controlId });
  assert.deepEqual(after, before, "Cleanup must not touch another circle");
  console.log("PASS uncertain membership discovered and removed; independent circle unchanged");
} finally {
  await target.cleanup();
  await control.cleanup();
  if (createdUser) await users.delete({ userId });
}
