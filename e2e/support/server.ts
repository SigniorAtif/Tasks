// The server the end-to-end test runs against: the real API, serving the built
// app (apps/web/dist) from the same origin, the way production does. It gets a
// port and a database of its own, so it never touches the dev server's data.

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const API_DIR = path.join(repoRoot, 'apps/api');

export const STATIC_DIR = path.join(repoRoot, 'apps/web/dist');
/** The API's entry point, which playwright.config.ts starts. */
export const API_MAIN = path.join(API_DIR, 'src/main.ts');

const PORT = 3100;
export const ORIGIN = `http://localhost:${PORT}`;

/** Emptied at every start (prepare.ts). CI's Postgres service creates it; locally prepare.ts does. */
export const DATABASE_URL = 'postgres://tasks:tasks@localhost:5432/tasks_e2e';

/** The user the test signs in as: the API only lets allowlisted emails in. */
export const TEST_EMAIL = 'you@example.com';

/**
 * The API's environment (apps/api/src/env.ts). Not production, so the session
 * cookie is signed with the public development secret, which is also what the
 * dev:session script signs with.
 */
export const SERVER_ENV = {
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: String(PORT),
  LOG_LEVEL: 'warn',
  DATABASE_URL,
  BETTER_AUTH_URL: ORIGIN,
  AUTH_ALLOWED_EMAILS: TEST_EMAIL,
  STATIC_DIR,
};

/**
 * Runs one of the API's own scripts (a path inside apps/api) with the server's
 * environment, so it works on the test's database, and returns what it printed.
 */
export function runApiScript(script: string, args: readonly string[] = []): string {
  return execFileSync(process.execPath, [path.join(API_DIR, script), ...args], {
    env: { ...process.env, ...SERVER_ENV },
    encoding: 'utf8',
  });
}
