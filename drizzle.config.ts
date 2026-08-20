import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './server/db/schema.ts',
  out: './server/db/migrations-pg',
  dbCredentials: { url: process.env.SONDARA_DATABASE_URL ?? 'postgresql://sondara:sondara@127.0.0.1:5432/sondara' },
  strict: true,
  verbose: true,
})
