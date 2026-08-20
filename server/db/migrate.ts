import { resolve } from 'node:path'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { db, sqlite } from './client.js'

migrate(db, { migrationsFolder: resolve(process.cwd(), 'server/db/migrations') })
sqlite.close()
console.log('Sondara database migrations completed.')
