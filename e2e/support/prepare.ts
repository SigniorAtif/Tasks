// Runs just before the test's server starts (playwright.config.ts): check the
// app is built, create the database if it's missing, apply the API's
// migrations with its own script, then empty every table, so each run starts
// with no user and no classes.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { Client, escapeIdentifier } from 'pg';
import { DATABASE_URL, runApiScript, STATIC_DIR } from './server.ts';

if (!existsSync(path.join(STATIC_DIR, 'index.html'))) {
  throw new Error(
    `${STATIC_DIR} has no index.html. Build the app first: pnpm --filter @tasks/web build (pnpm e2e does).`,
  );
}

const url = new URL(DATABASE_URL);
const name = decodeURIComponent(url.pathname.slice(1));

// CREATE DATABASE can't run inside the database it creates: use `postgres`.
const maintenance = new URL(url);
maintenance.pathname = '/postgres';
const admin = await connect(maintenance.toString());
try {
  const found = await admin.query('select 1 from pg_database where datname = $1', [name]);
  if (found.rowCount === 0) await admin.query(`create database ${escapeIdentifier(name)}`);
} finally {
  await admin.end();
}

runApiScript('src/db/migrate.ts');

// Every table in `public`, listed by Postgres so a new one is never missed. The
// migrations' own bookkeeping lives in the `drizzle` schema and stays.
const db = await connect(DATABASE_URL);
try {
  const { rows } = await db.query<{ name: string }>(
    `select format('%I', tablename) as name from pg_tables where schemaname = 'public'`,
  );
  if (rows.length > 0) await db.query(`truncate ${rows.map((row) => row.name).join(', ')} cascade`);
} finally {
  await db.end();
}

async function connect(connectionString: string): Promise<Client> {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    return client;
  } catch (error) {
    await client.end().catch(() => {});
    throw new Error(
      `Couldn't connect to Postgres at ${url.host} (the cause is below). Locally, is it running? docker compose up -d --wait db`,
      { cause: error },
    );
  }
}
