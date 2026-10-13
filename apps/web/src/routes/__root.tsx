import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Link, Outlet, useMatches } from '@tanstack/react-router';

/** What every route receives in `context` (see src/router.ts). */
export interface RouterContext {
  queryClient: QueryClient;
}

declare module '@tanstack/react-router' {
  // Fixed facts a route declares about itself, read here through useMatches().
  interface StaticDataRouteOption {
    /**
     * The screen fills the window (up to a wide column on a desktop) and
     * scrolls inside itself, like the calendar. Without it, a screen gets a
     * phone-width centred column and the page scrolls, like /login.
     */
    wide?: boolean;
  }
}

// The root route wraps every screen, padded clear of the notch, the gesture
// bar and (in landscape) the side cut-outs when installed full-screen.
export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: NotFound,
});

function RootLayout() {
  const wide = useMatches({ select: (matches) => matches.some((m) => m.staticData.wide) });

  if (wide) {
    // Exactly the window's height (dvh: the height left by the phone's
    // browser bars), so the calendar grid can take what's left under its
    // title bar and scroll inside itself.
    return (
      <div className="mx-auto flex h-dvh w-full max-w-6xl flex-col pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]">
        <Outlet />
      </div>
    );
  }
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
