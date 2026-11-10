import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Navigate } from '@tanstack/react-router';
import { useState } from 'react';
import { GoneScreen, ScreenFrame } from '../components/ScreenFrame.tsx';
import { isUnauthenticated } from '../lib/api.ts';
import { groupsQuery, meQuery, seriesListQuery } from '../lib/queries.ts';
import { requireSession } from '../lib/require-session.ts';
import { todayFor } from '../lib/time.ts';
import { SeriesForm } from '../series/SeriesForm.tsx';

// `/series/<id>`: the form to change or delete one class. The calendar opens
// it when a block is tapped (`occurrence.seriesId`).
export const Route = createFileRoute('/series/$seriesId')({
  beforeLoad: ({ context }) => requireSession(context.queryClient),
  // The series comes from the list every screen shares (there's no "one
  // series" read yet), and the group select needs the groups.
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(seriesListQuery),
      context.queryClient.ensureQueryData(groupsQuery),
    ]);
  },
  component: EditSeriesRoute,
});

function EditSeriesRoute() {
  const { seriesId } = Route.useParams();
  // A new id is a new form: `key` starts it from scratch rather than keeping
  // the last series' half-typed values.
  return <EditSeriesScreen key={seriesId} seriesId={seriesId} />;
}

function EditSeriesScreen({ seriesId }: { seriesId: string }) {
  const me = useSuspenseQuery(meQuery);
  const list = useSuspenseQuery(seriesListQuery);
  const groups = useSuspenseQuery(groupsQuery);

  const found = list.data.series.find((s) => s.id === seriesId);
  // The series as the screen first found it. After Delete, the refetched list
  // no longer has it; keep drawing the form for the moment until the app has
  // gone back to the calendar, instead of flashing "doesn't exist".
  const [firstFound] = useState(found);
  const series = found ?? firstFound;

  if (isUnauthenticated(me.error)) return <Navigate to="/login" replace />;
  if (series === undefined) {
    return <GoneScreen title="This class doesn't exist any more" back="calendar" />;
  }

  return (
    <ScreenFrame title="Edit class" back="calendar">
      <SeriesForm series={series} groups={groups.data.groups} today={todayFor(me.data.profile)} />
    </ScreenFrame>
  );
}
