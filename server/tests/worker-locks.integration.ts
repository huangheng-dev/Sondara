import assert from "node:assert/strict";
import { databaseRuntime, pool } from "../db/client.js";
import { withMigrationLock } from "../db/migration-lock.js";
import { acquireLeaderLease, LEADER_KEYS } from "../lib/leader-lock.js";

const MIGRATION_LOCK_KEY = 0x534f4e44;

const run = async () => {
  const outboxLease = await acquireLeaderLease(LEADER_KEYS.outbox);
  assert.ok(outboxLease, "expected to acquire the first outbox leader lease");

  const competingLease = await acquireLeaderLease(LEADER_KEYS.outbox);
  assert.equal(competingLease, null, "a second worker must not acquire the same leader lock");

  const otherWorkerLease = await acquireLeaderLease(LEADER_KEYS.radar);
  assert.ok(otherWorkerLease, "different worker types must use independent locks");
  await otherWorkerLease.release();

  await outboxLease.release();
  const reacquiredLease = await acquireLeaderLease(LEADER_KEYS.outbox);
  assert.ok(reacquiredLease, "leader lock should become available after release");
  await reacquiredLease.release();

  const migrationOwner = await pool.connect();
  try {
    await migrationOwner.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    await assert.rejects(
      withMigrationLock(async () => {
        throw new Error("protected migration operation should not run");
      }),
      /另一个实例正在执行数据库迁移/,
    );
  } finally {
    await migrationOwner.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
    migrationOwner.release();
  }

  let migrationRan = false;
  await withMigrationLock(async () => {
    migrationRan = true;
  });
  assert.equal(migrationRan, true);

  await databaseRuntime.close();
  console.log("Worker lock integration passed: leader lease exclusivity, release/reacquire and migration lock verified.");
};

run().then(
  () => process.exit(0),
  async (error) => {
    console.error(error);
    await databaseRuntime.close().catch(() => undefined);
    process.exit(1);
  },
);
