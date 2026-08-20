import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, types } from "pg";
import { config } from "../config.js";
import * as schema from "./schema.js";

// PostgreSQL returns int8 (including count(*)) as strings by default. Sondara's
// IDs are textual and all int8 values are bounded timestamps/counters, so the
// numeric parser keeps API responses consistent with the TypeScript schema.
types.setTypeParser(20, value => Number(value));

const pool = new Pool({
  connectionString: config.databaseUrl,
  max: Number(process.env.SONDARA_DATABASE_POOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  allowExitOnIdle: true,
  application_name: "sondara",
});

const nativeDb = drizzle(pool, { schema });

export const db = Object.assign(nativeDb, {
  $first: async <T>(query: PromiseLike<T[]>): Promise<T | undefined> => {
    const rows = await query;
    return rows[0];
  },
});

export const databaseRuntime = {
  driver: "postgres" as const,
  close: () => pool.end(),
  ping: async () => {
    const result = await pool.query<{ ok: number }>("select 1 as ok");
    return result.rows[0];
  },
};
