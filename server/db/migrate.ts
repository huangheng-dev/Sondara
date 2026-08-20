import { resolve } from 'node:path'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { databaseRuntime, db } from './client.js'

await migrate(db, { migrationsFolder: resolve(process.cwd(), 'server/db/migrations-pg') })
await databaseRuntime.close()
console.log(`Sondara ${databaseRuntime.driver} database migrations completed.`)
