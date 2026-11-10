import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Navigate } from '@tanstack/react-router';
import { ScreenFrame } from '../components/ScreenFrame.tsx';
import { GroupList, NewGroupLink } from '../groups/GroupList.tsx';
import { isUnauthenticated } from '../lib/api.ts';
import { groupsQuery, meQuery } from '../lib/queries.ts';
import { requireSession } from '../lib/require-session.ts';
import { todayFor } from '../lib/time.ts';

// `/groups`: every group, the running ones first, then the archived ones.
// Reached from the account menu.
export const Route = createFileRoute('/groups/')({
  beforeLoad: ({ context }) => requireSession(context.queryClient),
  // From the cache when there is one (offline too), from the server otherwise.
  loader: ({ context }) => context.queryClient.ensureQueryData(groupsQuery),
  component: GroupsRoute,
});

function GroupsRoute() {
  const me = useSuspenseQuery(meQuery);
  const groups = useSuspenseQuery(groupsQuery);

  // The session ended while the screen was open (a refetch got a 401).
  if (isUnauthenticated(me.error)) return <Navigate to="/login" replace />;

  return (
    <ScreenFrame title="Groups" back="calendar" action={<NewGroupLink />}>
      <GroupList groups={groups.data.groups} today={todayFor(me.data.profile)} />
    </ScreenFrame>
  );
}
