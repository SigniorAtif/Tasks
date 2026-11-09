import { Link } from '@tanstack/react-router';
import type { ISODate, ScheduleGroup } from '@tasks/core';
import { groupColor } from '../calendar/model/palette.ts';
import { groupSections, groupSummary } from './group-list.ts';

/** "New group", beside the Groups screen's title. */
export function NewGroupLink() {
  return (
    <Link
      to="/groups/new"
      className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:bg-indigo-500 dark:hover:bg-indigo-400"
    >
      <span aria-hidden="true">+</span> New group
    </Link>
  );
}

/**
 * Every group: the ones still running first, then the archived ones under
 * their own heading, each sorted by name. A row opens the group's form.
 */
export function GroupList({
  groups,
  today,
}: {
  groups: readonly ScheduleGroup[];
  /** The user's day (`todayFor`): what counts as archived. */
  today: ISODate;
}) {
  if (groups.length === 0) {
    return (
      <div className="rounded-xl p-5 text-center ring-1 ring-slate-200 dark:ring-slate-800">
        <p className="font-medium">No groups yet</p>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          A group holds classes you manage together, like a semester. Make one here, or while adding
          a class.
        </p>
      </div>
    );
  }

  const { active, archived } = groupSections(groups, today);
  return (
    <div className="flex flex-col gap-6">
      {active.length > 0 ? (
        <GroupRows groups={active} today={today} label="Groups" />
      ) : (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          No group is running now. The ones that have ended are below.
        </p>
      )}
      {archived.length > 0 && (
        <section aria-labelledby="groups-archived" className="flex flex-col gap-2">
          <h2
            id="groups-archived"
            className="px-1 text-sm font-semibold text-slate-600 dark:text-slate-400"
          >
            Archived
          </h2>
          <GroupRows groups={archived} today={today} label="Archived groups" muted />
        </section>
      )}
    </div>
  );
}

function GroupRows({
  groups,
  today,
  label,
  muted = false,
}: {
  groups: readonly ScheduleGroup[];
  today: ISODate;
  label: string;
  muted?: boolean;
}) {
  return (
    <ul
      aria-label={label}
      className="divide-y divide-slate-200 overflow-hidden rounded-xl ring-1 ring-slate-200 dark:divide-slate-800 dark:ring-slate-800"
    >
      {groups.map((group) => {
        const summary = groupSummary(group, today);
        return (
          <li key={group.id}>
            <Link
              to="/groups/$groupId"
              params={{ groupId: group.id }}
              className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-slate-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-indigo-600 dark:hover:bg-slate-800"
            >
              <span
                aria-hidden="true"
                style={{ backgroundColor: groupColor(group.colorToken) }}
                className={`size-4 shrink-0 rounded-full ${muted ? 'opacity-50' : ''}`}
              />
              <span className="min-w-0 flex-1">
                <span
                  className={`block truncate font-medium ${muted ? 'text-slate-600 dark:text-slate-400' : ''}`}
                >
                  {group.name}
                </span>
                {summary !== '' && (
                  <span className="block text-sm text-slate-600 dark:text-slate-400">
                    {summary}
                  </span>
                )}
              </span>
              <span aria-hidden="true" className="text-slate-400">
                ›
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
