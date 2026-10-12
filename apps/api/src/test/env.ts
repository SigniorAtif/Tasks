import { type Env, parseEnv } from '../env.ts';

/** The database the tests may wipe: `TEST_DATABASE_URL`, or its default. Never `DATABASE_URL`. */
export function testDatabaseUrl(): string {
  const parsed = parseEnv({ TEST_DATABASE_URL: process.env.TEST_DATABASE_URL });
  if (!parsed.ok) throw new Error(`TEST_DATABASE_URL is invalid: ${parsed.problems.join('; ')}`);
  return parsed.env.TEST_DATABASE_URL;
}

/**
 * A complete test environment, independent of the developer's shell and `.env`
 * (only `TEST_DATABASE_URL` is read). The app under test talks to the test
 * database. `overrides` replace single variables, as a real `.env` would.
 */
export function testEnv(overrides: Record<string, string | undefined> = {}): Env {
  const parsed = parseEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: testDatabaseUrl(),
    TEST_DATABASE_URL: testDatabaseUrl(),
    ...overrides,
  });
  if (!parsed.ok) throw new Error(`invalid test environment: ${parsed.problems.join('; ')}`);
  return parsed.env;
}
