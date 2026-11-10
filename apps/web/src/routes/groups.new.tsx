import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Navigate } from '@tanstack/react-router';
import { ScreenFrame } from '../components/ScreenFrame.tsx';
import { GroupForm } from '../groups/GroupForm.tsx';
import { isUnauthenticated } from '../lib/api.ts';
import { meQuery } from '../lib/queries.ts';
import { requireSession } from '../lib/require-session.ts';
import { todayFor } from '../lib/time.ts';

// `/groups/new`: make a group before its first class.
export const Route = createFileRoute('/groups/new')({
  beforeLoad: ({ context }) => requireSession(context.queryClient),
  component: NewGroupRoute,
});

function NewGroupRoute() {
  const me = useSuspenseQuery(meQuery);
  if (isUnauthenticated(me.error)) return <Navigate to="/login" replace />;

  return (
    <ScreenFrame title="New group" back="groups">
      <GroupForm group={null} today={todayFor(me.data.profile)} />
    </ScreenFrame>
  );
}
