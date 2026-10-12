import type { Me } from '@tasks/core';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authUser, profile } from '../db/schema.ts';
import { findProfile } from '../profile/profile.ts';
import { createTestApp } from '../test/app.ts';
import { cookieHeader } from '../test/cookies.ts';
import { resetDatabase, testDb } from '../test/database.ts';
import { testEnv } from '../test/env.ts';
import { signInWithGoogle, TEST_GOOGLE } from '../test/sign-in.ts';

const alice = {
  sub: 'google-sub-alice',
  email: 'alice@example.com',
  name: 'Alice',
  picture: 'https://example.com/alice.png',
};
const bob = { sub: 'google-sub-bob', email: 'bob@example.com', name: 'Bob' };

function testApp() {
  return createTestApp({
    env: testEnv({ ...TEST_GOOGLE, AUTH_ALLOWED_EMAILS: 'alice@example.com,bob@example.com' }),
  });
}

async function signIn(app: ReturnType<typeof testApp>, user: typeof alice | typeof bob) {
  const { callback } = await signInWithGoogle(app.app, app.env, user);
  vi.unstubAllGlobals();
  return cookieHeader(callback);
}

async function userId(email: string): Promise<string> {
  const [row] = await testDb.select().from(authUser).where(eq(authUser.email, email));
  if (!row) throw new Error(`no user ${email}`);
  return row.id;
}

async function getMe(app: ReturnType<typeof testApp>, cookie: string) {
  const response = await app.app.request('/api/v1/me', { headers: { cookie } });
  expect(response.status).toBe(200);
  return { response, me: (await response.json()) as Me };
}

beforeEach(() => resetDatabase());
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /api/v1/me', () => {
  it('returns the signed-in user, their default profile and the server time', async () => {
    const app = testApp();
    const cookie = await signIn(app, alice);
    const { response, me } = await getMe(app, cookie);

    expect(me).toEqual({
      user: {
        id: await userId('alice@example.com'),
        email: 'alice@example.com',
        name: 'Alice',
        image: 'https://example.com/alice.png',
      },
      profile: { tzid: 'Asia/Kolkata', dayBoundary: '04:00' },
      serverTime: '2026-10-12T04:30:00.000Z',
    });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('sends image as null when Google has no picture', async () => {
    const app = testApp();
    const { me } = await getMe(app, await signIn(app, bob));
    expect(me.user.image).toBeNull();
  });

  it('recreates a missing profile with the defaults instead of failing', async () => {
    const app = testApp();
    const cookie = await signIn(app, alice);
    await testDb.delete(profile);

    const { me } = await getMe(app, cookie);
    expect(me.profile).toEqual({ tzid: 'Asia/Kolkata', dayBoundary: '04:00' });
    expect(await testDb.select().from(profile)).toHaveLength(1);
  });
});

// A10: there is no row-level security yet, so the only thing keeping users
// apart is that every query filters by the session's user id. This test is
// the tripwire for the day a query forgets to.
describe('two users', () => {
  it('each see only their own profile', async () => {
    const app = testApp();
    const aliceCookie = await signIn(app, alice);
    const bobCookie = await signIn(app, bob);
    const aliceId = await userId('alice@example.com');
    const bobId = await userId('bob@example.com');
    await testDb
      .update(profile)
      .set({ tzid: 'Europe/London', dayBoundary: '03:00' })
      .where(eq(profile.userId, bobId));

    const asAlice = (await getMe(app, aliceCookie)).me;
    const asBob = (await getMe(app, bobCookie)).me;
    expect(asAlice.user).toMatchObject({ id: aliceId, email: 'alice@example.com' });
    expect(asAlice.profile).toEqual({ tzid: 'Asia/Kolkata', dayBoundary: '04:00' });
    expect(asBob.user).toMatchObject({ id: bobId, email: 'bob@example.com' });
    expect(asBob.profile).toEqual({ tzid: 'Europe/London', dayBoundary: '03:00' });

    // And the lookup function itself filters by the id it's given.
    expect(await findProfile(testDb, aliceId)).toEqual({
      tzid: 'Asia/Kolkata',
      dayBoundary: '04:00',
    });
    expect(await findProfile(testDb, bobId)).toEqual({
      tzid: 'Europe/London',
      dayBoundary: '03:00',
    });
    expect(await findProfile(testDb, '01920000-0000-7000-8000-000000000000')).toBeUndefined();
  });
});
