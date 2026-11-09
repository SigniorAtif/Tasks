// Signing the test's browser in without Google, the way a developer does
// locally: the API's dev:session script makes the user and a session, and
// prints the cookie a real sign-in would have set.

import type { BrowserContext } from '@playwright/test';
import { ORIGIN, runApiScript, TEST_EMAIL } from './server.ts';

/** Gives `context` a session cookie for the test's user. */
export async function signIn(context: BrowserContext): Promise<void> {
  const output = runApiScript('src/scripts/dev-session.ts', [TEST_EMAIL]);
  // The lines apps/api/src/auth/dev-session.test.ts pins.
  const name = /^Cookie name: +(\S+)$/m.exec(output)?.[1];
  const value = /^Cookie value: (\S+)$/m.exec(output)?.[1];
  if (name === undefined || value === undefined) {
    throw new Error(`dev:session printed no cookie:\n${output}`);
  }
  await context.addCookies([{ name, value, url: ORIGIN, httpOnly: true, sameSite: 'Lax' }]);
}
