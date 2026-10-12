import { describe, expect, it } from 'vitest';
import { DEV_AUTH_SECRET, parseEnv } from './env.ts';

/** A complete, valid production environment. Tests remove or break one variable at a time. */
const production = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://tasks:pw@db:5432/tasks',
  BETTER_AUTH_URL: 'https://tasks.example.com',
  BETTER_AUTH_SECRET: 'a'.repeat(32),
  GOOGLE_CLIENT_ID: 'client-id.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  AUTH_ALLOWED_EMAILS: 'you@example.com',
};

function problemsOf(source: Record<string, string | undefined>): string[] {
  const result = parseEnv(source);
  if (result.ok) throw new Error('expected the environment to be rejected');
  return result.problems;
}

describe('parseEnv in development', () => {
  it('runs with nothing set, using the defaults from .env.example', () => {
    const result = parseEnv({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.env).toMatchObject({
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: 3000,
      LOG_LEVEL: 'info',
      DATABASE_URL: 'postgres://tasks:tasks@localhost:5432/tasks',
      TEST_DATABASE_URL: 'postgres://tasks:tasks@localhost:5432/tasks_test',
      BETTER_AUTH_URL: 'http://localhost:5173',
      BETTER_AUTH_SECRET: DEV_AUTH_SECRET,
      AUTH_ALLOWED_EMAILS: ['you@example.com'],
      GIT_SHA: 'dev',
      STATIC_DIR: undefined,
    });
    expect(result.env.GOOGLE_CLIENT_ID).toBeUndefined();
  });

  it('treats empty and blank values as unset', () => {
    const result = parseEnv({ PORT: '', BETTER_AUTH_SECRET: '   ', STATIC_DIR: '' });
    expect(result.ok && result.env.PORT).toBe(3000);
    expect(result.ok && result.env.BETTER_AUTH_SECRET).toBe(DEV_AUTH_SECRET);
    expect(result.ok && result.env.STATIC_DIR).toBeUndefined();
  });

  it('normalises the allowlist: trimmed, lower-case, no empty entries', () => {
    const result = parseEnv({ AUTH_ALLOWED_EMAILS: ' Alice@Example.com, ,bob@example.com ' });
    expect(result.ok && result.env.AUTH_ALLOWED_EMAILS).toEqual([
      'alice@example.com',
      'bob@example.com',
    ]);
  });

  it('strips a trailing slash from BETTER_AUTH_URL and rejects a path', () => {
    const ok = parseEnv({ BETTER_AUTH_URL: 'http://localhost:5173/' });
    expect(ok.ok && ok.env.BETTER_AUTH_URL).toBe('http://localhost:5173');
    expect(problemsOf({ BETTER_AUTH_URL: 'http://localhost:5173/app' })).toEqual([
      'BETTER_AUTH_URL: must be an origin like https://tasks.ahmedatif.in, with no path',
    ]);
  });

  it('resolves STATIC_DIR to an absolute path', () => {
    const result = parseEnv({ STATIC_DIR: 'some/dir' });
    expect(result.ok && result.env.STATIC_DIR).toMatch(/^\/.*\/some\/dir$/);
  });

  it('names every bad variable at once', () => {
    expect(
      problemsOf({
        PORT: 'eighty',
        LOG_LEVEL: 'loud',
        DATABASE_URL: 'mysql://x',
        AUTH_ALLOWED_EMAILS: 'not-an-email',
      }).map((problem) => problem.split(':')[0]),
    ).toEqual(['PORT', 'LOG_LEVEL', 'DATABASE_URL', 'AUTH_ALLOWED_EMAILS (item 0)']);
  });

  it('refuses half a Google client', () => {
    expect(problemsOf({ GOOGLE_CLIENT_ID: 'id-only' })).toEqual([
      'GOOGLE_CLIENT_ID: set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or neither',
    ]);
  });

  it('refuses a short secret in any environment', () => {
    expect(problemsOf({ BETTER_AUTH_SECRET: 'short' })).toEqual([
      'BETTER_AUTH_SECRET: must be at least 32 characters',
    ]);
  });
});

describe('parseEnv in production', () => {
  it('accepts a complete environment', () => {
    expect(parseEnv(production).ok).toBe(true);
  });

  it('requires every secret and URL instead of falling back to dev values', () => {
    expect(problemsOf({ NODE_ENV: 'production' })).toEqual([
      'DATABASE_URL: is required in production',
      'BETTER_AUTH_URL: is required in production',
      'BETTER_AUTH_SECRET: is required in production',
      'GOOGLE_CLIENT_ID: is required in production',
      'GOOGLE_CLIENT_SECRET: is required in production',
      'AUTH_ALLOWED_EMAILS: is required in production',
    ]);
  });

  it('refuses the public development secret', () => {
    expect(problemsOf({ ...production, BETTER_AUTH_SECRET: DEV_AUTH_SECRET })).toEqual([
      'BETTER_AUTH_SECRET: is the public development value; generate one with `openssl rand -base64 32`',
    ]);
  });

  it('never repeats a value in its messages', () => {
    const secret = 'short-secret-value';
    const problems = problemsOf({ ...production, BETTER_AUTH_SECRET: secret, PORT: 'x9y8z7' });
    expect(problems.join('\n')).not.toContain(secret);
    expect(problems.join('\n')).not.toContain('x9y8z7');
  });
});
