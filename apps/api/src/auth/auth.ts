// Browser sign-in (D-058–D-060): Better Auth, running inside our API, handles
// "Sign in with Google", the OAuth state/PKCE checks and the session cookie.
// This file is its configuration; `require-session.ts` uses it per request.

import { paths } from '@tasks/core';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Database } from '../db/client.ts';
import { authAccount, authSession, authUser, authVerification } from '../db/schema.ts';
import type { Env } from '../env.ts';
import type { Logger } from '../logger.ts';
import { ensureProfile } from '../profile/profile.ts';
import { isEmailAllowed, NOT_INVITED } from './allowlist.ts';

const DAY_SECONDS = 24 * 60 * 60;

export interface AuthDeps {
  env: Env;
  db: Database;
  logger: Logger;
}

/** Thrown from a hook, Better Auth turns it into `?error=not_invited` on the error page. */
function notInvited(): APIError {
  return new APIError('FORBIDDEN', {
    code: NOT_INVITED,
    message: 'This app is private. Your Google account is not on its list.',
  });
}

export function createAuth({ env, db, logger }: AuthDeps) {
  const log = logger.child({ module: 'better-auth' });
  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            // Always show Google's account picker: students juggle a personal
            // and a university account, and the wrong one would be refused.
            prompt: 'select_account' as const,
          },
        }
      : {};

  return betterAuth({
    appName: 'Tasks',
    // The origin the browser sees (Vite's in development), so redirects and
    // the Google redirect URI point there: <BETTER_AUTH_URL>/api/auth/callback/google.
    baseURL: env.BETTER_AUTH_URL,
    basePath: paths.auth,
    secret: env.BETTER_AUTH_SECRET,
    // Requests that change state must come from this exact origin, no wildcards.
    trustedOrigins: [env.BETTER_AUTH_URL],

    database: drizzleAdapter(db, {
      provider: 'pg',
      // Better Auth's model names are our table names, so they read the same everywhere.
      schema: {
        auth_user: authUser,
        auth_session: authSession,
        auth_account: authAccount,
        auth_verification: authVerification,
      },
      // A new user and their Google account row are written together or not at all.
      transaction: true,
    }),
    user: { modelName: 'auth_user' },
    account: { modelName: 'auth_account' },
    verification: { modelName: 'auth_verification' },
    session: {
      modelName: 'auth_session',
      // 30 days, sliding: each day of use pushes the expiry 30 days out again.
      expiresIn: 30 * DAY_SECONDS,
      updateAge: DAY_SECONDS,
      // "Fresh" = signed in within 10 minutes; future sensitive actions will require it.
      freshAge: 10 * 60,
      // Look the session up in Postgres on every request rather than trusting a
      // cached copy in a second cookie: signing out anywhere takes effect at once.
      cookieCache: { enabled: false },
    },

    // No passwords, ever (D-059). Google is the only way in, when it's configured.
    emailAndPassword: { enabled: false },
    socialProviders: google,

    advanced: {
      // UUIDv7 ids made in our code (D-034): time-ordered, and the future `sub`
      // of a shared identity (D-063).
      database: { generateId: () => uuidv7() },
      // `Secure` cookies (and the `__Secure-` name prefix) exactly when the
      // site is served over https. No `crossSubDomainCookies`: the cookie is
      // host-only, sent to this host and no other (D-063).
      useSecureCookies: env.BETTER_AUTH_URL.startsWith('https:'),
      // Better Auth skips its origin check when NODE_ENV=test. Keep it on, so
      // the tests exercise the same protection production has.
      disableOriginCheck: false,
    },

    // Where a failed sign-in lands when the PWA didn't name a page itself:
    // our login screen, as /login?error=<code> (e.g. `not_invited`).
    onAPIError: { errorURL: `${env.BETTER_AUTH_URL}/login` },

    databaseHooks: {
      user: {
        create: {
          // Runs before the user row is inserted: a stranger never gets a row at all.
          before: async (user) => {
            if (!isEmailAllowed(env.AUTH_ALLOWED_EMAILS, user.email)) throw notInvited();
            return { data: user };
          },
          // Runs after the row (and its transaction) is committed.
          after: async (user) => {
            await ensureProfile(db, user.id);
          },
        },
      },
      session: {
        create: {
          // Someone taken off the list keeps their user row but can't start new sessions.
          before: async (session) => {
            const [owner] = await db
              .select({ email: authUser.email })
              .from(authUser)
              .where(eq(authUser.id, session.userId));
            if (!owner || !isEmailAllowed(env.AUTH_ALLOWED_EMAILS, owner.email)) {
              throw notInvited();
            }
            return { data: session };
          },
        },
      },
    },

    // Better Auth's own messages go through pino, with our redaction rules.
    // Extra arguments are dropped, except errors: they can carry provider
    // responses (tokens included) that have no business in a log.
    logger: {
      disabled: env.LOG_LEVEL === 'silent',
      level: betterAuthLevel(env.LOG_LEVEL),
      log: (level, message, ...args) => {
        const err = args.find((arg) => arg instanceof Error);
        log[level]({ ...(err ? { err } : {}) }, message);
      },
    },
    telemetry: { enabled: false },
  });
}

export type Auth = ReturnType<typeof createAuth>;

function betterAuthLevel(level: Env['LOG_LEVEL']): 'debug' | 'info' | 'warn' | 'error' {
  if (level === 'trace' || level === 'debug') return 'debug';
  if (level === 'info') return 'info';
  if (level === 'warn') return 'warn';
  return 'error';
}
