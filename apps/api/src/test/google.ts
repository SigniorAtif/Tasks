// A stand-in for Google during tests. The only call Better Auth makes to Google
// in the redirect flow is the code-for-tokens exchange at the token endpoint;
// it reads the user's email and name from the `id_token` that comes back.
// Any other outbound request fails the test, so nothing leaves the machine.

import { vi } from 'vitest';

export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

export interface FakeGoogleUser {
  /** Google's permanent id for the account. */
  sub: string;
  email: string;
  name: string;
  picture?: string;
}

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/**
 * An id_token shaped like Google's. Unsigned: in the redirect flow Better Auth
 * receives it straight from Google over TLS and only decodes it.
 */
export function fakeIdToken(clientId: string, user: FakeGoogleUser): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', kid: 'test-key', typ: 'JWT' };
  const claims = {
    iss: 'https://accounts.google.com',
    aud: clientId,
    sub: user.sub,
    email: user.email,
    email_verified: true,
    name: user.name,
    picture: user.picture,
    iat: now,
    exp: now + 3600,
  };
  return `${base64url(header)}.${base64url(claims)}.unsigned`;
}

/**
 * Replaces the global `fetch` until `vi.unstubAllGlobals()`. Google's token
 * endpoint answers as if `user` had just picked their account; each exchange
 * is recorded in `tokenRequests` so tests can check what was sent.
 */
export function mockGoogle(clientId: string, user: FakeGoogleUser) {
  const tokenRequests: URLSearchParams[] = [];
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.method === 'POST' && request.url === GOOGLE_TOKEN_URL) {
      tokenRequests.push(new URLSearchParams(await request.text()));
      return Response.json({
        access_token: 'ya29.fake-access-token',
        expires_in: 3599,
        scope: 'openid https://www.googleapis.com/auth/userinfo.email',
        token_type: 'Bearer',
        id_token: fakeIdToken(clientId, user),
      });
    }
    throw new Error(`unexpected outbound request in a test: ${request.method} ${request.url}`);
  });
  return { tokenRequests };
}
