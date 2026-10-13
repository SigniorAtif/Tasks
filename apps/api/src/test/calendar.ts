// Helpers for the calendar route tests: users signed in through the real app
// (Google replaced by `mockGoogle`), a small JSON client per user, and request
// bodies built from the made-up sample timetable.

import type { CreateGroup, CreateSeries } from '@tasks/core';
import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { vi } from 'vitest';
import { authUser } from '../db/schema.ts';
import { createTestApp } from './app.ts';
import { cookieHeader } from './cookies.ts';
import { testDb } from './database.ts';
import { testEnv } from './env.ts';
import type { FakeGoogleUser } from './google.ts';
import { signInWithGoogle, TEST_GOOGLE } from './sign-in.ts';

export const alice: FakeGoogleUser = {
  sub: 'google-sub-alice',
  email: 'alice@example.com',
  name: 'Alice',
};
export const bob: FakeGoogleUser = { sub: 'google-sub-bob', email: 'bob@example.com', name: 'Bob' };

export type TestApp = ReturnType<typeof calendarTestApp>;

/** The real app, with alice and bob on the allowlist. */
export function calendarTestApp() {
  return createTestApp({
    env: testEnv({ ...TEST_GOOGLE, AUTH_ALLOWED_EMAILS: 'alice@example.com,bob@example.com' }),
  });
}

/** Sends requests as one signed-in user, the way the PWA does. */
export interface Client {
  userId: string;
  get(path: string): Promise<Response>;
  /** A string body is sent as it is (for malformed JSON); anything else as JSON. */
  post(path: string, body: unknown): Promise<Response>;
  patch(path: string, body: unknown): Promise<Response>;
  delete(path: string): Promise<Response>;
}

export async function signIn(test: TestApp, user: FakeGoogleUser): Promise<Client> {
  const { callback } = await signInWithGoogle(test.app, test.env, user);
  vi.unstubAllGlobals();
  const cookie = cookieHeader(callback);
  const [row] = await testDb.select().from(authUser).where(eq(authUser.email, user.email));
  if (!row) throw new Error(`${user.email} did not get a user row`);

  const send = async (method: string, path: string, body?: unknown): Promise<Response> =>
    test.app.request(path, {
      method,
      headers: {
        cookie,
        origin: test.env.BETTER_AUTH_URL,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined
        ? {}
        : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    });

  return {
    userId: row.id,
    get: (path) => send('GET', path),
    post: (path, body) => send('POST', path, body),
    patch: (path, body) => send('PATCH', path, body),
    delete: (path) => send('DELETE', path),
  };
}

/** A new client-generated id, as the PWA makes them (D-034). */
export const newId = (): string => uuidv7();

/** A `POST /api/v1/groups` body: the sample's semester group. */
export function groupBody(fields: Partial<CreateGroup> = {}): CreateGroup {
  return {
    id: newId(),
    name: 'Classes · Sem 3 (sample)',
    activeFrom: '2026-07-13',
    activeTo: '2026-11-27',
    ...fields,
  };
}

/** A `POST /api/v1/series` body: the sample's Data Structures class. */
export function seriesBody(groupId: string, fields: Partial<CreateSeries> = {}): CreateSeries {
  return {
    id: newId(),
    groupId,
    title: 'Data Structures',
    location: 'C-301',
    rule: { freq: 'weekly', interval: 1, byDay: ['MO', 'WE', 'FR'] },
    startDate: '2026-07-13',
    startTime: '08:00',
    durationMin: 60,
    ...fields,
  };
}

/** Reads a JSON response body as `T` (the tests then check it really is). */
export async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}
