import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Navigate } from '@tanstack/react-router';
import { isUnauthenticated } from '../lib/api.ts';
import { groupsQuery, meQuery } from '../lib/queries.ts';
import { requireSession } from '../lib/require-session.ts';
import { todayIn } from '../series/form-values.ts';
import { SeriesForm } from '../series/SeriesForm.tsx';
import { SeriesScreen } from '../series/SeriesScreen.tsx';

// `/series/new`: the form to add a class.
export const Route = createFileRoute('/series/new')({
  beforeLoad: ({ context }) => requireSession(context.queryClient),
  // The group select needs the groups before the form draws. From the cache
  // when there is one (offline too), from the server otherwise.
  loader: ({ context }) => context.queryClient.ensureQueryData(groupsQuery),
  component: NewSeriesScreen,
});

function NewSeriesScreen() {
  const me = useSuspenseQuery(meQuery);
  const groups = useSuspenseQuery(groupsQuery);

  // The session ended while the screen was open (a refetch got a 401).
  if (isUnauthenticated(me.error)) return <Navigate to="/login" replace />;

  return (
    <SeriesScreen title="Add a class">
      <SeriesForm series={null} groups={groups.data.groups} today={todayIn(me.data.profile.tzid)} />
    </SeriesScreen>
  );
}
