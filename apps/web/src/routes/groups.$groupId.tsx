import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Navigate } from '@tanstack/react-router';
import { GoneScreen, ScreenFrame } from '../components/ScreenFrame.tsx';
import { GroupForm } from '../groups/GroupForm.tsx';
import { isUnauthenticated } from '../lib/api.ts';
import { groupsQuery, meQuery } from '../lib/queries.ts';
import { requireSession } from '../lib/require-session.ts';
import { todayFor } from '../lib/time.ts';

// `/groups/<id>`: change one group. The Groups screen opens it from a row.
export const Route = createFileRoute('/groups/$groupId')({
  beforeLoad: ({ context }) => requireSession(context.queryClient),
  // The group comes from the list every screen shares (there's no "one group" read).
  loader: ({ context }) => context.queryClient.ensureQueryData(groupsQuery),
  component: EditGroupRoute,
});

function EditGroupRoute() {
  const { groupId } = Route.useParams();
  // A new id is a new form: `key` starts it from scratch rather than keeping
  // the last group's half-typed values.
  return <EditGroupScreen key={groupId} groupId={groupId} />;
}

function EditGroupScreen({ groupId }: { groupId: string }) {
  const me = useSuspenseQuery(meQuery);
  const groups = useSuspenseQuery(groupsQuery);
  const group = groups.data.groups.find((g) => g.id === groupId);

  if (isUnauthenticated(me.error)) return <Navigate to="/login" replace />;
  if (group === undefined) {
    return <GoneScreen title="This group doesn't exist any more" back="groups" />;
  }

  return (
    <ScreenFrame title="Edit group" back="groups">
      <GroupForm group={group} today={todayFor(me.data.profile)} />
    </ScreenFrame>
  );
}
