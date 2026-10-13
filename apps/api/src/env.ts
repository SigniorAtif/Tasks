// Every setting the API needs, read from environment variables and checked once
// at start-up. The rest of the code receives the typed `Env` object and never
// reads `process.env` itself, so a typo'd or missing variable fails here, loudly,
// instead of half an hour later inside a request. The list and its meaning are
// in `.env.example` at the repo root.

import path from 'node:path';
import { z } from 'zod';

/**
 * A fixed secret so a fresh clone runs without a `.env`. It is public (it's in
 * this file), so anyone could sign cookies with it: production refuses it.
 */
export const DEV_AUTH_SECRET = 'dev-only-secret-not-for-production-0123456789';

/** What development and test use when a variable is unset. Matches `.env.example`. */
const DEV_DEFAULTS = {
  DATABASE_URL: 'postgres://tasks:tasks@localhost:5432/tasks',
  BETTER_AUTH_URL: 'http://localhost:5173',
  BETTER_AUTH_SECRET: DEV_AUTH_SECRET,
  AUTH_ALLOWED_EMAILS: ['you@example.com'],
};

/** The variables production must set explicitly: no default is safe for them. */
const REQUIRED_IN_PRODUCTION = [
  'DATABASE_URL',
  'BETTER_AUTH_URL',
  'BETTER_AUTH_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'AUTH_ALLOWED_EMAILS',
] as const;

const postgresUrl = z.url({
  protocol: /^postgres(ql)?$/,
  error: 'must be a postgres:// URL',
});

/** An origin is scheme + host + port and nothing else, e.g. `https://tasks.ahmedatif.in`. */
const origin = z
  .url({ protocol: /^https?$/, error: 'must be an http(s) URL' })
  .refine((value) => new URL(value).origin === value.replace(/\/$/, ''), {
    error: 'must be an origin like https://tasks.ahmedatif.in, with no path',
  })
  .transform((value) => new URL(value).origin);

/** `"A@x.com, b@y.com"` → `["a@x.com", "b@y.com"]`. Emails compare case-insensitively. */
const emailList = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email !== ''),
  )
  .pipe(z.array(z.email({ error: 'must be a comma-separated list of emails' })).min(1));

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    DATABASE_URL: postgresUrl.optional(),
    TEST_DATABASE_URL: postgresUrl.default('postgres://tasks:tasks@localhost:5432/tasks_test'),
    BETTER_AUTH_URL: origin.optional(),
    BETTER_AUTH_SECRET: z.string().min(32, 'must be at least 32 characters').optional(),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    AUTH_ALLOWED_EMAILS: emailList.optional(),
    GIT_SHA: z.string().default('dev'),
    STATIC_DIR: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      for (const name of REQUIRED_IN_PRODUCTION) {
        if (env[name] === undefined) {
          ctx.addIssue({ code: 'custom', path: [name], message: 'is required in production' });
        }
      }
      if (env.BETTER_AUTH_SECRET === DEV_AUTH_SECRET) {
        ctx.addIssue({
          code: 'custom',
          path: ['BETTER_AUTH_SECRET'],
          message: 'is the public development value; generate one with `openssl rand -base64 32`',
        });
      }
    }
    // Half a Google client is a typo, not a choice.
    if ((env.GOOGLE_CLIENT_ID === undefined) !== (env.GOOGLE_CLIENT_SECRET === undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['GOOGLE_CLIENT_ID'],
        message: 'set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or neither',
      });
    }
  })
  .transform((env) => ({
    ...env,
    // In production these are present (checked above); elsewhere, fill the dev defaults.
    DATABASE_URL: env.DATABASE_URL ?? DEV_DEFAULTS.DATABASE_URL,
    BETTER_AUTH_URL: env.BETTER_AUTH_URL ?? DEV_DEFAULTS.BETTER_AUTH_URL,
    BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET ?? DEV_DEFAULTS.BETTER_AUTH_SECRET,
    AUTH_ALLOWED_EMAILS: env.AUTH_ALLOWED_EMAILS ?? DEV_DEFAULTS.AUTH_ALLOWED_EMAILS,
    STATIC_DIR: env.STATIC_DIR === undefined ? undefined : path.resolve(env.STATIC_DIR),
  }));

export type Env = z.output<typeof schema>;

export type EnvResult = { ok: true; env: Env } | { ok: false; problems: string[] };

/**
 * Checks a set of variables. Pure, so tests can pass any object. Empty or
 * blank values count as unset, so `PORT=` in a `.env` means "use the default".
 * The problems name the variable and the rule, never the value: a value
 * might be a secret, and these messages end up in logs.
 */
export function parseEnv(source: Record<string, string | undefined>): EnvResult {
  const present = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value.trim() !== ''),
  );
  const result = schema.safeParse(present);
  if (result.success) return { ok: true, env: result.data };
  const problems = result.error.issues.map((issue) => {
    const [name, ...rest] = issue.path.map(String);
    const where = rest.length > 0 ? `${name} (item ${rest.join('.')})` : name;
    return `${where}: ${issue.message}`;
  });
  return { ok: false, problems };
}

/** Reads `process.env`, or prints what's wrong and stops the process. */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = parseEnv(source);
  if (!result.ok) {
    console.error(
      `The API can't start: some environment variables are wrong (see .env.example).\n${result.problems
        .map((problem) => `  - ${problem}`)
        .join('\n')}`,
    );
    process.exit(1);
  }
  return result.env;
}
