// A way to be "signed in" on your own machine without Google: create the user
// (if needed) and a fresh session, and hand back the exact cookie the browser
// would have received. For local checks and screenshots before a Google OAuth
// client exists. It refuses to run for any origin but localhost.

import { makeSignature } from 'better-auth/crypto';
import type { Database } from '../db/client.ts';
import type { Env } from '../env.ts';
import { ensureProfile } from '../profile/profile.ts';
import { isEmailAllowed } from './allowlist.ts';
import type { Auth } from './auth.ts';

/** True only for `http(s)://localhost[:port]` and `http(s)://127.0.0.1[:port]`. */
export function isLocalOrigin(origin: string): boolean {
  const { hostname } = new URL(origin);
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

export interface DevSession {
  email: string;
  userId: string;
  createdUser: boolean;
  /** `better-auth.session_token`, or `__Secure-better-auth.session_token` on https. */
  cookieName: string;
  /** Exactly what a `Set-Cookie` header would carry: the token, a dot and its signature. */
  cookieValue: string;
  expiresAt: Date;
}

export async function createDevSession(
  deps: { env: Env; auth: Auth; db: Database },
  rawEmail: string,
): Promise<DevSession> {
  const { env, auth, db } = deps;
  if (!isLocalOrigin(env.BETTER_AUTH_URL)) {
    throw new Error(
      `refusing to mint a session for ${env.BETTER_AUTH_URL}: dev sessions are for localhost only`,
    );
  }
  const email = rawEmail.trim().toLowerCase();
  if (!isEmailAllowed(env.AUTH_ALLOWED_EMAILS, email)) {
    throw new Error(`${email} is not in AUTH_ALLOWED_EMAILS`);
  }

  // Better Auth's own internals, so the rows and the cookie are exactly what a
  // real sign-in produces (and the allowlist hooks run as usual).
  const ctx = await auth.$context;
  const existing = await ctx.internalAdapter.findUserByEmail(email);
  const user =
    existing?.user ??
    (await ctx.internalAdapter.createUser(
      { email, name: email.split('@')[0] ?? email, emailVerified: true },
      { method: 'dev-session' },
    ));
  await ensureProfile(db, user.id);

  const session = await ctx.internalAdapter.createSession(user.id);
  if (!session) throw new Error('Better Auth did not create a session');

  // The cookie is the session token plus an HMAC signature made with
  // BETTER_AUTH_SECRET, URL-encoded the way Better Auth's Set-Cookie sends it.
  const signature = await makeSignature(session.token, ctx.secret);
  return {
    email,
    userId: user.id,
    createdUser: !existing,
    cookieName: ctx.authCookies.sessionToken.name,
    cookieValue: encodeURIComponent(`${session.token}.${signature}`),
    expiresAt: session.expiresAt,
  };
}
