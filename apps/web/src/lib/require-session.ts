import type { QueryClient } from '@tanstack/react-query';
import { redirect } from '@tanstack/react-router';
import { isUnauthenticated } from './api.ts';
import { meQuery } from './queries.ts';

/**
 * For a route's `beforeLoad`: makes sure someone is signed in before the screen
 * draws. With no session, goes to /login straight away, so the page never
 * flashes. Any other failure (offline with nothing cached, a server error)
 * falls through to the route's error screen.
 *
 * Offline, the user restored from the device (src/lib/persist.ts) counts:
 * `ensureQueryData` returns what's cached without asking the server.
 */
export async function requireSession(queryClient: QueryClient): Promise<void> {
  try {
    await queryClient.ensureQueryData(meQuery);
  } catch (error) {
    if (isUnauthenticated(error)) throw redirect({ to: '/login' });
    throw error;
  }
}
