import { pool } from "./client.js";

const MIGRATION_LOCK_KEY = 0x534f4e44; // "SOND"

export const withMigrationLock = async <T>(operation: () => Promise<T>): Promise<T> => {
  const client = await pool.connect();
  try {
    const locked = await client.query<{ locked: boolean }>(
      "select pg_try_advisory_lock($1) as locked",
      [MIGRATION_LOCK_KEY],
    );
    if (!locked.rows[0]?.locked) {
      throw new Error("另一个实例正在执行数据库迁移，请稍后重试。");
    }
    return await operation();
  } finally {
    await client
      .query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY])
      .catch(() => undefined);
    client.release();
  }
};
