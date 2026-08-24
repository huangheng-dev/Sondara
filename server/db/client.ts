import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "../config.js";
import * as schema from "./schema.js";

mkdirSync(dirname(config.databasePath), { recursive: true });
export const sqliteClient = createClient({ url: config.databaseUrl });
await sqliteClient.execute("PRAGMA journal_mode = WAL");
await sqliteClient.execute("PRAGMA foreign_keys = ON");
await sqliteClient.execute("PRAGMA busy_timeout = 5000");

const nativeDb = drizzle(sqliteClient, { schema });

export const db = Object.assign(nativeDb, {
  $first: async <T>(query: PromiseLike<T[]>): Promise<T | undefined> => {
    const rows = await query;
    return rows[0];
  },
});

export const databaseRuntime = {
  driver: "sqlite" as const,
  close: async () => sqliteClient.close(),
  ping: async () => {
    const result = await sqliteClient.execute("select 1 as ok");
    return result.rows[0];
  },
};
