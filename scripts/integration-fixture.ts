import { randomBytes } from "node:crypto";
import { Permission, Query, Role } from "node-appwrite";
import { getServerAppwrite } from "../src/lib/appwrite/server";
import { TABLES } from "../src/lib/domain/schema";
import { stableRowId } from "../src/lib/domain/ids";

// Each run owns a separate namespace. Cleanup never adopts existing resources.
export async function integrationFixture(suite: "schedule" | "recipient") {
  const run = randomBytes(8).toString("hex");
  const circleId = `test_${suite}_${run}`;
  const teamId = `test_team_${run}`;
  const ownerId = `test_owner_${run}`;
  const caregiverId = `test_carer_${run}`;
  const recipientId = `test_person_${run}`;
  const { databaseId, tables, users, teams } = getServerAppwrite();
  const createdUsers: string[] = [];
  const createdRows: { tableId: string; rowId: string }[] = [];
  let createdTeam = false;
  let createdCircle = false;
  const read = [Permission.read(Role.team(teamId))];
  const isMissing = (error: unknown) => (error as {code?:number})?.code === 404;

  async function cleanup() {
    const errors: unknown[] = [];
    const attempt = async (operation: () => Promise<unknown>) => {
      try { await operation(); } catch (error) { if (!isMissing(error)) errors.push(error); }
    };
    // Domain functions can create rows before returning. Discover only our circle's
    // descendants, rather than relying on IDs returned after successful calls.
    if (createdCircle) {
      for (const tableId of [TABLES.occurrences, TABLES.schedules, TABLES.recipients]) {
        await attempt(async () => {
          const found = await tables.listRows({ databaseId, tableId, queries: [Query.equal("circleId", [circleId]), Query.limit(100)], total: false });
          if (found.rows.length === 100) throw new Error(`Unexpected fixture size in ${tableId}; manual inspection required.`);
          for (const row of found.rows) {
            if (row.circleId !== circleId) throw new Error("Fixture ownership mismatch.");
            await attempt(() => tables.deleteRow({ databaseId, tableId, rowId: row.$id }));
          }
        });
      }
    }
    for (const row of [...createdRows].reverse()) await attempt(() => tables.deleteRow({ databaseId, ...row }));
    if (createdTeam) await attempt(() => teams.delete({ teamId }));
    for (const userId of [...createdUsers].reverse()) await attempt(() => users.delete({ userId }));
    if (errors.length) throw new AggregateError(errors, `Fixture cleanup incomplete: ${circleId}; inspect only this namespace.`);
    console.log(`Cleaned isolated ${suite} fixture ${circleId}`);
  }

  try {
    for (const [userId, name] of [[ownerId, "Synthetic owner"], [caregiverId, "Synthetic caregiver"]]) {
      await users.create({ userId, email: `${userId}@example.invalid`, name });
      createdUsers.push(userId);
    }
    await teams.create({ teamId, name: `OneDose ${suite} test`, roles: ["owner", "caregiver"] });
    createdTeam = true;
    for (const [index, userId] of [ownerId, caregiverId].entries()) {
      await teams.createMembership({ teamId, membershipId: `test_mem_${index}_${run}`, userId, roles: [index === 0 ? "owner" : "caregiver"] });
    }
    for (const row of [
      {tableId:TABLES.circles,rowId:circleId,data:{name:`Synthetic ${suite} circle`,teamId,timezone:"Asia/Dubai",archivedAt:null}},
      ...[ownerId,caregiverId].map((userId,index)=>({tableId:TABLES.members,rowId:stableRowId("mem",`${circleId}:${userId}`),data:{circleId,userId,role:index===0?"owner":"caregiver",status:"active",lastMutationAt:null}})),
      {tableId:TABLES.recipients,rowId:recipientId,data:{circleId,displayName:"Synthetic test recipient",timezone:"Asia/Dubai",archivedAt:null}},
    ]) {
      await tables.createRow({ databaseId, ...row, permissions: read });
      createdRows.push({tableId:row.tableId,rowId:row.rowId});
      if (row.tableId === TABLES.circles) createdCircle = true;
    }
    return { circleId, ownerId, caregiverId, recipientId, databaseId, tables, cleanup };
  } catch (error) {
    try { await cleanup(); } catch (cleanupError) { throw new AggregateError([error,cleanupError],"Fixture setup and cleanup failed."); }
    throw error;
  }
}
