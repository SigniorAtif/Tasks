import type { Problem } from '@tasks/core';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authAccount, authSession, authUser, profile } from '../db/schema.ts';
import { createTestApp } from '../test/app.ts';
import { findSetCookie } from '../test/cookies.ts';
import { resetDatabase, testDb } from '../test/database.ts';
import { testEnv } from '../test/env.ts';
import { signInWithGoogle, TEST_GOOGLE } from '../test/sign-in.ts';

const SESSION_COOKIE = 'better-auth.session_token';
const alice = { sub: 'google-sub-alice', email: 'Alice@Example.com', name: 'Alice' };
const mallory = { sub: 'google-sub-mallory', email: 'mallory@example.com', name: 'Mallory' };

/** The usual test app, with Google configured and only Alice on the allowlist. */
function aliceOnlyApp(overrides: Record<string, string> = {}) {
  return createTestApp({
    env: testEnv({ ...TEST_GOOGLE, AUTH_ALLOWED_EMAILS: 'alice@example.com', ...overrides }),
  });
}

/** Signs Alice in and returns the `Cookie` header her browser would now send. */
async function aliceCookie(app: ReturnType<typeof aliceOnlyApp>) {
  const { callback } = await signInWithGoogle(app.app, app.env, alice);
  const cookie = findSetCookie(callback, SESSION_COOKIE);
  if (!cookie) throw new Error('no session cookie');
  return `${cookie.name}=${cookie.value}`;
}

async function count(table: typeof authUser | typeof authSession | typeof profile) {
  const [row] = await testDb.select({ n: sql<number>`count(*)::int` }).from(table);
  return row?.n ?? 0;
}

beforeEach(() => resetDatabase());
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the session gate on /api/*', () => {
  it.each(['/api/v1/me', '/api/v1/does-not-exist', '/api/anything'])(
    'answers %s without a session with 401, not 404',
    async (path) => {
      const { app } = aliceOnlyApp();
      const response = await app.request(path);
      expect(response.status).toBe(401);
      expect(response.headers.get('content-type')).toBe('application/problem+json');
      const problem = (await response.json()) as Problem;
      expect(problem).toMatchObject({ code: 'unauthenticated', status: 401 });
      expect(problem.requestId).toBe(response.headers.get('x-request-id'));
    },
  );

  it('treats a forged cookie like no cookie', async () => {
    const { app } = aliceOnlyApp();
    const response = await app.request('/api/v1/me', {
      headers: { cookie: `${SESSION_COOKIE}=made-up-token.made-up-signature` },
    });
    expect(response.status).toBe(401);
  });

  it('leaves /healthz and Better Auth routes public', async () => {
    const { app } = aliceOnlyApp();
    expect((await app.request('/healthz')).status).toBe(200);
    const ok = await app.request('/api/auth/ok');
    expect(ok.status).toBe(200);
    expect(ok.headers.get('x-request-id')).toBeTruthy();
  });
});

describe('signing in with Google', () => {
  it('sends the browser to Google with our client, callback and account picker', async () => {
    const { app, env } = aliceOnlyApp();
    const { googleUrl, tokenRequests } = await signInWithGoogle(app, env, alice);

    expect(googleUrl.origin + googleUrl.pathname).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth',
    );
    const params = googleUrl.searchParams;
    expect(params.get('client_id')).toBe(TEST_GOOGLE.GOOGLE_CLIENT_ID);
    expect(params.get('redirect_uri')).toBe('http://localhost:5173/api/auth/callback/google');
    expect(params.get('prompt')).toBe('select_account');
    expect(params.get('code_challenge_method')).toBe('S256');
    expect(params.get('scope')?.split(' ')).toEqual(
      expect.arrayContaining(['openid', 'email', 'profile']),
    );

    // The code is exchanged with the PKCE verifier and the same redirect URI.
    expect(tokenRequests).toHaveLength(1);
    expect(tokenRequests[0]?.get('code')).toBe('fake-code');
    expect(tokenRequests[0]?.get('code_verifier')).toBeTruthy();
    expect(tokenRequests[0]?.get('redirect_uri')).toBe(
      'http://localhost:5173/api/auth/callback/google',
    );
  });

  it('creates the user, their profile and a session for an allowlisted email', async () => {
    const { app, env } = aliceOnlyApp();
    const { callback } = await signInWithGoogle(app, env, alice);

    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toBe('/');

    const [user] = await testDb.select().from(authUser);
    expect(user).toMatchObject({ email: 'alice@example.com', name: 'Alice', emailVerified: true });
    // A UUIDv7 made in our code.
    expect(user?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    const userId = user?.id ?? '';

    const [account] = await testDb.select().from(authAccount);
    expect(account).toMatchObject({ userId, providerId: 'google', accountId: alice.sub });
    expect(await testDb.select().from(profile).where(eq(profile.userId, userId))).toHaveLength(1);
    const [session] = await testDb.select().from(authSession);
    expect(session?.userId).toBe(userId);

    // The cookie: HttpOnly (no JavaScript access), SameSite=Lax, host-only
    // (no Domain), 30 days, and not Secure because this origin is plain http.
    const cookie = findSetCookie(callback, SESSION_COOKIE);
    expect(cookie?.value.startsWith(`${session?.token}.`)).toBe(true);
    expect(cookie?.attributes.has('httponly')).toBe(true);
    expect(cookie?.attributes.get('samesite')?.toLowerCase()).toBe('lax');
    expect(cookie?.attributes.get('path')).toBe('/');
    expect(cookie?.attributes.get('max-age')).toBe(String(30 * 24 * 60 * 60));
    expect(cookie?.attributes.has('domain')).toBe(false);
    expect(cookie?.attributes.has('secure')).toBe(false);
  });

  it('lets the new cookie through the session gate', async () => {
    const app = aliceOnlyApp();
    const cookie = await aliceCookie(app);

    const session = await app.app.request('/api/auth/get-session', { headers: { cookie } });
    expect(((await session.json()) as { user: { email: string } }).user.email).toBe(
      'alice@example.com',
    );
    // Signed in, so an unknown path is now an honest 404 instead of a 401.
    const missing = await app.app.request('/api/v1/does-not-exist', { headers: { cookie } });
    expect(missing.status).toBe(404);
  });

  it('signs a returning user in again without creating a second user', async () => {
    const app = aliceOnlyApp();
    await aliceCookie(app);
    await aliceCookie(app);
    expect(await count(authUser)).toBe(1);
    expect(await count(authSession)).toBe(2);
  });

  it('uses a __Secure- cookie with the Secure flag when the site is https', async () => {
    const { app, env } = aliceOnlyApp({ BETTER_AUTH_URL: 'https://tasks.example.com' });
    const { callback } = await signInWithGoogle(app, env, alice);
    const cookie = findSetCookie(callback, `__Secure-${SESSION_COOKIE}`);
    expect(cookie?.attributes.has('secure')).toBe(true);
    expect(cookie?.attributes.has('domain')).toBe(false);
  });

  // The PWA relies on this answer to say "Google sign-in isn't set up".
  it('answers 404 PROVIDER_NOT_FOUND when no Google client is configured', async () => {
    const { app, env } = createTestApp(); // no GOOGLE_CLIENT_ID / SECRET
    const response = await app.request('/api/auth/sign-in/social', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: env.BETTER_AUTH_URL },
      body: JSON.stringify({ provider: 'google', callbackURL: '/', errorCallbackURL: '/login' }),
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'PROVIDER_NOT_FOUND' });
  });
});

describe('the allowlist', () => {
  it('turns away an email that is not on the list before a user row exists', async () => {
    const { app, env } = aliceOnlyApp();
    const { callback } = await signInWithGoogle(app, env, mallory, { errorCallbackURL: '/login' });

    expect(callback.status).toBe(302);
    const location = new URL(callback.headers.get('location') ?? '', 'http://localhost:5173');
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('error')).toBe('not_invited');

    expect(await count(authUser)).toBe(0);
    expect(await count(authSession)).toBe(0);
    expect(findSetCookie(callback, SESSION_COOKIE)).toBeUndefined();
  });

  it('sends a rejected visitor to /login even when the PWA names no error page', async () => {
    const { app, env } = aliceOnlyApp();
    const { callback } = await signInWithGoogle(app, env, mallory);
    expect(callback.headers.get('location')).toMatch(
      /^http:\/\/localhost:5173\/login\?error=not_invited(&|$)/,
    );
  });

  it('refuses new sessions, and stops old ones working, once an email is removed', async () => {
    const before = aliceOnlyApp();
    const oldCookie = await aliceCookie(before);

    const after = aliceOnlyApp({ AUTH_ALLOWED_EMAILS: 'someone-else@example.com' });
    const { callback } = await signInWithGoogle(after.app, after.env, alice);
    expect(callback.headers.get('location')).toMatch(/\/login\?error=not_invited/);
    expect(await count(authSession)).toBe(1); // only the session from before

    const response = await after.app.request('/api/v1/does-not-exist', {
      headers: { cookie: oldCookie },
    });
    expect(response.status).toBe(403);
    expect(((await response.json()) as Problem).code).toBe('forbidden');
  });

  it('rejects a callback whose state was not issued to this browser', async () => {
    const { app, env } = aliceOnlyApp();
    const { callback, tokenRequests } = await signInWithGoogle(app, env, alice, {
      state: 'forged-state',
    });
    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toMatch(/\/login\?error=/);
    expect(tokenRequests).toHaveLength(0); // never got as far as asking Google
    expect(await count(authUser)).toBe(0);
  });
});

describe('sessions', () => {
  it('slides the expiry forward and re-sends the cookie after a day of use', async () => {
    const app = aliceOnlyApp();
    const cookie = await aliceCookie(app);
    // Pretend the session was last extended two days ago.
    const twoDaysOld = new Date(Date.now() + 28 * 24 * 60 * 60 * 1000);
    await testDb.update(authSession).set({ expiresAt: twoDaysOld });

    const response = await app.app.request('/api/v1/does-not-exist', { headers: { cookie } });
    expect(response.status).toBe(404);
    expect(findSetCookie(response, SESSION_COOKIE)?.attributes.get('max-age')).toBe(
      String(30 * 24 * 60 * 60),
    );
    const [session] = await testDb.select().from(authSession);
    expect(session?.expiresAt.getTime()).toBeGreaterThan(twoDaysOld.getTime());
  });

  it('refuses a cross-site form POST to our API even with a valid cookie (CSRF)', async () => {
    const app = aliceOnlyApp();
    const cookie = await aliceCookie(app);
    const forged = await app.app.request('/api/v1/does-not-exist', {
      method: 'POST',
      headers: {
        cookie,
        origin: 'https://evil.example',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'title=pwned',
    });
    expect(forged.status).toBe(403);
    expect(((await forged.json()) as Problem).code).toBe('forbidden');

    const sameOrigin = await app.app.request('/api/v1/does-not-exist', {
      method: 'POST',
      headers: {
        cookie,
        origin: 'http://localhost:5173',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'title=fine',
    });
    expect(sameOrigin.status).toBe(404);
  });
});
