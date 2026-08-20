import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './server/db/schema.ts',
  out: './server/db/migrations',
  dbCredentials: { url: process.env.SONDARA_DATABASE_URL ?? './data/sondara.db' },
  strict: true,
  verbose: true,
})
