// The router decides which screen to draw for the current URL, without asking
// the server for a new page (a single-page app). Routes live one per file in
// src/routes/; the router plugin in vite.config.ts writes routeTree.gen.ts
// from them, and that file is committed so `pnpm typecheck` works in a fresh
// clone.

import { createRouter } from '@tanstack/react-router';
import { ErrorScreen } from './components/ErrorScreen.tsx';
import { PendingScreen } from './components/PendingScreen.tsx';
import { createQueryClient } from './lib/query-client.ts';
import { routeTree } from './routeTree.gen.ts';

/** The one cache of API data for the whole app. */
export const queryClient = createQueryClient();

export const router = createRouter({
  routeTree,
  // Handed to every route's `beforeLoad` and `loader`, so they can read and
  // fill the cache before the screen draws.
  context: { queryClient },
  // Shown while a route waits for its data (after a short delay, so fast
  // loads don't flash a spinner), and when loading it fails.
  defaultPendingComponent: PendingScreen,
  defaultErrorComponent: ErrorScreen,
});

// Teaches TypeScript about our routes, so `<Link to="/logn">` is a type error.
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
