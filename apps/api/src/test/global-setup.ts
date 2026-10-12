// Runs once before all test files (Vitest `globalSetup`). The integration
// tests use a real Postgres (D-017), in a database of their own that they are
// allowed to wipe: create it if it's missing, then apply the migrations, the
// same way production does.
//
// On a laptop, Postgres is the `db` container from compose.yaml. If it isn't
// running, it's started here, so `pnpm test` works on its own. In CI (where
// GitHub sets CI=true) Postgres is a `services:` container that already
// exists, so nothing is started there.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client, escapeIdentifier } from 'pg';
import { runMigrations } from '../db/migrations.ts';
import { createPool } from '../db/pool.ts';
import { testDatabaseUrl } from './env.ts';

/** The repo root, where compose.yaml lives. */
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

export default async function setup(): Promise<void> {
  const url = new URL(testDatabaseUrl());
  const name = decodeURIComponent(url.pathname.slice(1));

  // CREATE DATABASE can't run inside the database it creates, so connect to
  // the `postgres` maintenance database that every server has.
  const maintenance = new URL(url);
  maintenance.pathname = '/postgres';
  const client = await connectStartingLocalPostgres(maintenance.toString(), url);
  try {
    const existing = await client.query('select 1 from pg_database where datname = $1', [name]);
    if (existing.rowCount === 0) await client.query(`create database ${escapeIdentifier(name)}`);
  } finally {
    await client.end();
  }

  const pool = createPool(url.toString());
  try {
    await runMigrations(pool);
  } finally {
    await pool.end();
  }
}

/**
 * Connects to Postgres. If nothing is listening and the tests point at the
 * compose database on this machine, starts it (`docker compose up --wait db`
 * returns once its health check passes) and connects again.
 */
async function connectStartingLocalPostgres(connectionString: string, url: URL): Promise<Client> {
  try {
    return await connect(connectionString);
  } catch (error) {
    if (!isConnectionRefused(error) || !mayStartComposeDatabase(url)) {
      throw new Error(`The API tests need Postgres at ${url.host}, and it isn't answering.`, {
        cause: error,
      });
    }
  }

  console.log(`Postgres isn't running at ${url.host}; starting it with docker compose…`);
  try {
    execFileSync('docker', ['compose', 'up', '--detach', '--wait', 'db'], {
      cwd: repoRoot,
      stdio: 'inherit',
    });
  } catch (error) {
    throw new Error(
      "Couldn't start Postgres with `docker compose up -d --wait db` (Docker's message is above).",
      { cause: error },
    );
  }
  return connect(connectionString);
}

async function connect(connectionString: string): Promise<Client> {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    return client;
  } catch (error) {
    await client.end().catch(() => {});
    throw error;
  }
}

/**
 * Only the database compose.yaml provides: on this machine, on its port, and
 * not in CI. A TEST_DATABASE_URL pointing anywhere else is the developer's
 * own server, and starting a container for it would be wrong.
 */
function mayStartComposeDatabase(url: URL): boolean {
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  const composePort = (url.port || '5432') === '5432';
  return local && composePort && !process.env.CI;
}

/**
 * "Nothing is listening on that port". `localhost` can resolve to both ::1 and
 * 127.0.0.1, and Node then reports one AggregateError holding both refusals.
 */
function isConnectionRefused(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if ((error as NodeJS.ErrnoException).code === 'ECONNREFUSED') return true;
  return error instanceof AggregateError && error.errors.some(isConnectionRefused);
}
