import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Navigate, redirect } from '@tanstack/react-router';
import { CalendarScreen } from '../calendar/CalendarScreen.tsx';
import { AccountMenu } from '../components/AccountMenu.tsx';
import { Logo } from '../components/Logo.tsx';
import { isUnauthenticated } from '../lib/api.ts';
import { meQuery } from '../lib/queries.ts';

// `/`, the home screen: this week's calendar, with the account menu (sign out,
// deployed commit) behind the avatar.
export const Route = createFileRoute('/')({
  // The week view needs the whole window, not the phone-width column (__root.tsx).
  staticData: { wide: true },
  // Runs before anything draws. With no session, go to /login straight away,
  // so the page never flashes. Any other failure (offline, server error) falls
  // through to the route's error screen (src/components/ErrorScreen.tsx).
  beforeLoad: async ({ context }) => {
    try {
      await context.queryClient.ensureQueryData(meQuery);
    } catch (error) {
      if (isUnauthenticated(error)) throw redirect({ to: '/login' });
      throw error;
    }
  },
  component: HomeScreen,
});

function HomeScreen() {
  // Already in the cache (beforeLoad put it there), so this never waits.
  const me = useSuspenseQuery(meQuery);

  // The session ended while the screen was open (a refetch got a 401).
  if (isUnauthenticated(me.error)) return <Navigate to="/login" replace />;

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <CalendarScreen
        leading={
          <span className="flex shrink-0 items-center gap-2">
            <Logo className="size-8" />
            <span className="hidden text-lg font-semibold md:inline">Tasks</span>
          </span>
        }
        trailing={<AccountMenu user={me.data.user} />}
      />
    </main>
  );
}
