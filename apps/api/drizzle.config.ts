// Settings for drizzle-kit, the command-line half of Drizzle.
// `pnpm --filter @tasks/api db:generate --name <what-changed>` reads the schema,
// compares it with the snapshots in drizzle/meta, and writes the next SQL
// migration into drizzle/. Generating needs no database connection.
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  strict: true,
  verbose: true,
});
