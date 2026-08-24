import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './server/db/schema.ts',
  out: './server/db/migrations-sqlite',
  dbCredentials: { url: process.env.SONDARA_DATABASE_URL ?? 'file:./data/sondara.sqlite' },
  strict: true,
  verbose: true,
})
