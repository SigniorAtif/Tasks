import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router';

/** What every route receives in `context` (see src/router.ts). */
export interface RouterContext {
  queryClient: QueryClient;
}

// The root route wraps every screen: a single centred column sized for a phone,
// padded clear of the notch and the gesture bar when installed full-screen.
export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: NotFound,
});

function RootLayout() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pt-[max(env(safe-area-inset-top),1.5rem)] pb-[max(env(safe-area-inset-bottom),1.5rem)]">
      <Outlet />
    </div>
  );
}

function NotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <Link to="/" className="font-medium text-indigo-600 underline dark:text-indigo-400">
        Go home
      </Link>
    </div>
  );
}
