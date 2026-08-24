import assert from "node:assert/strict";
import { databaseRuntime } from "../db/client.js";
import { withMigrationLock } from "../db/migration-lock.js";
import { acquireLeaderLease, LEADER_KEYS } from "../lib/leader-lock.js";

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

  let releaseFirst: () => void = () => undefined;
  const first = withMigrationLock(() => new Promise<void>(resolve => { releaseFirst = resolve; }));
  let secondRan = false;
  const second = withMigrationLock(async () => { secondRan = true; });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(secondRan, false, "migration operations must be serialized");
  releaseFirst();
  await Promise.all([first, second]);
  assert.equal(secondRan, true);

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
