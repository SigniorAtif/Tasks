import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Navigate } from '@tanstack/react-router';
import { ScreenFrame } from '../components/ScreenFrame.tsx';
import { isUnauthenticated } from '../lib/api.ts';
import { groupsQuery, meQuery, seriesListQuery } from '../lib/queries.ts';
import { requireSession } from '../lib/require-session.ts';
import { todayIn } from '../series/form-values.ts';
import { SeriesForm } from '../series/SeriesForm.tsx';

// `/series/new`: the form to add a class.
export const Route = createFileRoute('/series/new')({
  beforeLoad: ({ context }) => requireSession(context.queryClient),
  // The group select needs the groups before the form draws, and the first day
  // suggests the earliest future first day in the group, from the series. From the cache when there
  // is one (offline too), from the server otherwise.
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(groupsQuery),
      context.queryClient.ensureQueryData(seriesListQuery),
    ]);
  },
  component: NewSeriesScreen,
});

function NewSeriesScreen() {
  const me = useSuspenseQuery(meQuery);
  const groups = useSuspenseQuery(groupsQuery);
  const list = useSuspenseQuery(seriesListQuery);

  // The session ended while the screen was open (a refetch got a 401).
  if (isUnauthenticated(me.error)) return <Navigate to="/login" replace />;

  return (
    <ScreenFrame title="Add a class" back="calendar">
      <SeriesForm
        series={null}
        groups={groups.data.groups}
        seriesList={list.data.series}
        today={todayIn(me.data.profile.tzid)}
      />
    </ScreenFrame>
  );
}
