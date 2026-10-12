// Drives "Sign in with Google" end to end against the real app, with Google
// itself replaced by `mockGoogle`. The steps are the browser's:
//   1. The PWA POSTs /api/auth/sign-in/social and gets Google's URL back.
//   2. The browser goes to Google; the person picks their account.
//   3. Google redirects to /api/auth/callback/google?code=…&state=…
//      and the browser brings along the `state` cookie from step 1.

import type { Hono } from 'hono';
import { expect } from 'vitest';
import type { Env } from '../env.ts';
import type { AppEnv } from '../http/context.ts';
import { cookieHeader } from './cookies.ts';
import { type FakeGoogleUser, mockGoogle } from './google.ts';

export const TEST_GOOGLE = {
  GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'test-client-secret',
};

export async function signInWithGoogle(
  app: Hono<AppEnv>,
  env: Env,
  user: FakeGoogleUser,
  options: { errorCallbackURL?: string; state?: string } = {},
) {
  const google = mockGoogle(env.GOOGLE_CLIENT_ID ?? '', user);

  const start = await app.request('/api/auth/sign-in/social', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: env.BETTER_AUTH_URL },
    body: JSON.stringify({
      provider: 'google',
      callbackURL: '/',
      ...(options.errorCallbackURL ? { errorCallbackURL: options.errorCallbackURL } : {}),
    }),
  });
  expect(start.status).toBe(200);
  const { url } = (await start.json()) as { url: string };
  const googleUrl = new URL(url);
  const state = options.state ?? googleUrl.searchParams.get('state') ?? '';

  const callback = await app.request(
    `/api/auth/callback/google?code=fake-code&state=${encodeURIComponent(state)}`,
    { headers: { cookie: cookieHeader(start) } },
  );
  return { googleUrl, callback, tokenRequests: google.tokenRequests };
}
