// Runs once before all test files (Vitest `globalSetup`). The integration
// tests use a real Postgres (D-017), in a database of their own that they are
// allowed to wipe: create it if it's missing, then apply the migrations, the
// same way production does.

import { Client, escapeIdentifier } from 'pg';
import { runMigrations } from '../db/migrations.ts';
import { createPool } from '../db/pool.ts';
import { testDatabaseUrl } from './env.ts';

export default async function setup(): Promise<void> {
  const url = new URL(testDatabaseUrl());
  const name = decodeURIComponent(url.pathname.slice(1));

  // CREATE DATABASE can't run inside the database it creates, so connect to
  // the `postgres` maintenance database that every server has.
  const maintenance = new URL(url);
  maintenance.pathname = '/postgres';
  const client = new Client({ connectionString: maintenance.toString() });
  try {
    await client.connect();
  } catch (error) {
    throw new Error(
      `The API tests need Postgres at ${url.host} (start it with \`docker compose up -d --wait db\`).`,
      { cause: error },
    );
  }
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
