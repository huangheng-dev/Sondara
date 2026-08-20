import Database from "better-sqlite3";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import * as schema from "../server/db/schema.js";

const argument = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const sqlitePath = resolve(argument("sqlite") ?? "./data/sondara.db");
const postgresUrl = argument("postgres") ?? process.env.SONDARA_DATABASE_URL;
const merge = process.argv.includes("--merge");
const keepSource = process.argv.includes("--keep-source");

if (!existsSync(sqlitePath)) throw new Error(`SQLite 文件不存在：${sqlitePath}`);
if (!postgresUrl || !/^postgres(?:ql)?:\/\//i.test(postgresUrl)) {
  throw new Error("请通过 --postgres=postgresql://... 或 SONDARA_DATABASE_URL 提供 PostgreSQL 地址。");
}

const sqlite = new Database(sqlitePath, { readonly: true, fileMustExist: true });
const pool = new Pool({ connectionString: postgresUrl, max: 1 });
const pgDb = drizzle(pool, { schema });

const quote = (identifier: string) => `"${identifier.replace(/"/g, '""')}"`;
let migrationSucceeded = false;

try {
  await migrate(pgDb, { migrationsFolder: resolve(process.cwd(), "server/db/migrations-pg") });
  if (!merge) {
    const existing = await pool.query("select count(*)::int as count from users");
    if (existing.rows[0].count > 0) throw new Error("目标 PostgreSQL 已有用户数据；如确认需要按主键合并，请增加 --merge。");
  }

  const sqliteTables = new Set((sqlite.prepare("select name from sqlite_master where type='table' and name not like 'sqlite_%'").all() as { name: string }[]).map(row => row.name));
  const pgTables = (await pool.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' and table_name not like '__drizzle%'")).rows.map(row => row.table_name);
  const foreignKeys = (await pool.query<{ child: string; parent: string }>(`
    select tc.table_name as child, ccu.table_name as parent
    from information_schema.table_constraints tc
    join information_schema.constraint_column_usage ccu on ccu.constraint_name=tc.constraint_name and ccu.constraint_schema=tc.constraint_schema
    where tc.constraint_type='FOREIGN KEY' and tc.table_schema='public'
  `)).rows;
  const dependencies = new Map(pgTables.map(table => [table, new Set<string>()]));
  for (const key of foreignKeys) if (key.child !== key.parent) dependencies.get(key.child)?.add(key.parent);
  const ordered: string[] = [];
  while (ordered.length < pgTables.length) {
    const ready = pgTables.filter(table => !ordered.includes(table) && [...(dependencies.get(table) ?? [])].every(parent => ordered.includes(parent)));
    if (!ready.length) throw new Error("PostgreSQL 表外键存在无法自动排序的循环依赖。");
    ordered.push(...ready);
  }

  await pool.query("begin");
  let total = 0;
  const sourceCounts = new Map<string, number>();
  for (const table of ordered) {
    if (!sqliteTables.has(table)) continue;
    const pgColumns = (await pool.query<{ column_name: string; data_type: string }>(
      "select column_name,data_type from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position",
      [table],
    )).rows;
    const sqliteColumns = new Set((sqlite.prepare(`pragma table_info(${quote(table)})`).all() as { name: string }[]).map(row => row.name));
    const columns = pgColumns.filter(column => sqliteColumns.has(column.column_name));
    if (!columns.length) continue;
    const rows = sqlite.prepare(`select ${columns.map(column => quote(column.column_name)).join(',')} from ${quote(table)}`).all() as Record<string, unknown>[];
    sourceCounts.set(table, rows.length);
    for (const row of rows) {
      const values = columns.map(column => column.data_type === "boolean" && row[column.column_name] !== null
        ? Boolean(row[column.column_name])
        : row[column.column_name]);
      const placeholders = values.map((_, index) => `$${index + 1}`).join(",");
      await pool.query(
        `insert into ${quote(table)} (${columns.map(column => quote(column.column_name)).join(',')}) values (${placeholders}) on conflict do nothing`,
        values,
      );
    }
    total += rows.length;
    console.log(`${table}: ${rows.length}`);
  }
  for (const [table, sourceCount] of sourceCounts) {
    const target = await pool.query<{ count: number }>(`select count(*)::int as count from ${quote(table)}`);
    if ((target.rows[0]?.count ?? 0) < sourceCount) {
      throw new Error(`${table} 校验失败：SQLite ${sourceCount} 行，PostgreSQL ${target.rows[0]?.count ?? 0} 行。`);
    }
  }
  await pool.query("commit");
  migrationSucceeded = true;
  console.log(`SQLite → PostgreSQL 迁移及逐表行数校验完成，共处理 ${total} 行。`);
} catch (error) {
  await pool.query("rollback").catch(() => undefined);
  throw error;
} finally {
  sqlite.close();
  await pool.end();
  if (migrationSucceeded && !keepSource) {
    await Promise.all([
      rm(sqlitePath, { force: true }),
      rm(`${sqlitePath}-wal`, { force: true }),
      rm(`${sqlitePath}-shm`, { force: true }),
    ]);
    console.log(`已删除迁移成功的 SQLite 源文件：${sqlitePath}`);
  } else if (migrationSucceeded) {
    console.log(`已按 --keep-source 保留 SQLite 源文件：${sqlitePath}`);
  }
}
