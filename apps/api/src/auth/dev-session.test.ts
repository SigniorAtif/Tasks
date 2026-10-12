import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Me } from '@tasks/core';
import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { authSession, authUser } from '../db/schema.ts';
import { createTestApp } from '../test/app.ts';
import { resetDatabase, testDb } from '../test/database.ts';
import { testDatabaseUrl, testEnv } from '../test/env.ts';
import { createDevSession, isLocalOrigin } from './dev-session.ts';

const run = promisify(execFile);
const SCRIPT = path.resolve(import.meta.dirname, '../scripts/dev-session.ts');

beforeEach(() => resetDatabase());

async function rows(table: typeof authUser | typeof authSession): Promise<number> {
  const [row] = await testDb.select({ n: sql<number>`count(*)::int` }).from(table);
  return row?.n ?? 0;
}

describe('isLocalOrigin', () => {
  it.each([
    'http://localhost',
    'http://localhost:5173',
    'https://localhost:8443',
    'http://127.0.0.1:3000',
  ])('accepts %s', (origin) => {
    expect(isLocalOrigin(origin)).toBe(true);
  });

  it.each([
    'https://tasks.ahmedatif.in',
    'http://localhost.evil.example',
    'http://127.0.0.1.nip.io',
    'http://192.168.1.10:5173',
  ])('refuses %s', (origin) => {
    expect(isLocalOrigin(origin)).toBe(false);
  });
});

describe('createDevSession', () => {
  it('mints a cookie that the real app accepts, reusing the user next time', async () => {
    const { app, env, auth } = createTestApp();
    const first = await createDevSession({ env, auth, db: testDb }, ' You@Example.com ');
    expect(first).toMatchObject({
      email: 'you@example.com',
      createdUser: true,
      cookieName: 'better-auth.session_token',
    });

    const response = await app.request('/api/v1/me', {
      headers: { cookie: `${first.cookieName}=${first.cookieValue}` },
    });
    expect(response.status).toBe(200);
    expect(((await response.json()) as Me).user).toMatchObject({
      id: first.userId,
      email: 'you@example.com',
    });

    const second = await createDevSession({ env, auth, db: testDb }, 'you@example.com');
    expect(second).toMatchObject({ createdUser: false, userId: first.userId });
    expect(await rows(authUser)).toBe(1);
    expect(await rows(authSession)).toBe(2);
  });

  it('refuses an email that is not on the allowlist', async () => {
    const { env, auth } = createTestApp();
    await expect(
      createDevSession({ env, auth, db: testDb }, 'mallory@example.com'),
    ).rejects.toThrow(/not in AUTH_ALLOWED_EMAILS/);
    expect(await rows(authUser)).toBe(0);
  });

  it('refuses a non-local origin before touching the database', async () => {
    const { env, auth } = createTestApp({
      env: testEnv({ BETTER_AUTH_URL: 'https://tasks.example.com' }),
    });
    await expect(createDevSession({ env, auth, db: testDb }, 'you@example.com')).rejects.toThrow(
      /localhost only/,
    );
    expect(await rows(authUser)).toBe(0);
  });
});

describe('the dev:session script', () => {
  /** A production-like environment, as in the Docker image. */
  const production = {
    PATH: process.env.PATH ?? '',
    NODE_ENV: 'production',
    DATABASE_URL: testDatabaseUrl(),
    BETTER_AUTH_SECRET: 'a-test-secret-that-is-long-enough-123456',
    GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'test-client-secret',
    AUTH_ALLOWED_EMAILS: 'you@example.com',
  };

  it('refuses to run when BETTER_AUTH_URL is not localhost', async () => {
    const result = run(process.execPath, [SCRIPT, 'you@example.com'], {
      env: { ...production, BETTER_AUTH_URL: 'https://tasks.ahmedatif.in' },
    });
    await expect(result).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('refuses to run'),
    });
    expect(await rows(authUser)).toBe(0);
  });

  it('works under NODE_ENV=production on localhost, as in the local Docker image', async () => {
    const { stdout } = await run(process.execPath, [SCRIPT, 'you@example.com'], {
      env: { ...production, BETTER_AUTH_URL: 'http://localhost' },
    });
    const value = /^Cookie value: (\S+)$/m.exec(stdout)?.[1];
    expect(stdout).toMatch(/^Cookie name: {2}better-auth\.session_token$/m);
    expect(value).toBeTruthy();

    // The same secret and origin the script used: the cookie opens /me.
    const { app } = createTestApp({
      env: testEnv({
        BETTER_AUTH_SECRET: production.BETTER_AUTH_SECRET,
        BETTER_AUTH_URL: 'http://localhost',
      }),
    });
    const response = await app.request('/api/v1/me', {
      headers: { cookie: `better-auth.session_token=${value}` },
    });
    expect(response.status).toBe(200);
  });
});
