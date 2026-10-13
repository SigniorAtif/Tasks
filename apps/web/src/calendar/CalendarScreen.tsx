// The home screen's body: a title bar with Previous / Today / Next, the grid,
// and its loading, empty and error states. It owns two pieces of UI state:
// the anchor date (which day the user is looking at) and, from the window's
// width, the view (one day on a phone, the week from 768 px).
//
// Data: the whole Monday-to-Sunday week around the anchor, in both views, so
// moving between days of one week needs no request, and the week next to it
// on either side is fetched in the background so Previous and Next are instant.

import {
  keepPreviousData,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { Navigate } from '@tanstack/react-router';
import type { DateWindow, ISODate, Occurrence } from '@tasks/core';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { describeError, isUnauthenticated } from '../lib/api.ts';
import { calendarQuery, groupsQuery, meQuery } from '../lib/queries.ts';
import { isKnownZone } from '../lib/time.ts';
import {
  addDays,
  type CalendarView,
  isWithin,
  mondayOf,
  navRange,
  stepAnchor,
  todayIn,
  weekDays,
} from './model/dates.ts';
import { dayHeader, dayLabel, longDayLabel, weekLabel } from './model/format.ts';
import { type GridGroup, TimeGrid } from './TimeGrid.tsx';
import { useMediaQuery } from './use-media-query.ts';
import { useServerMinute } from './use-server-minute.ts';

/** From this width the screen shows the whole week; below it, one day (B11). */
const WEEK_VIEW_QUERY = '(min-width: 768px)';

/** Pixels per minute: 60 px an hour on a phone, 72 on a wider screen. */
const PX_PER_MIN = { day: 1, week: 1.2 } as const;

/**
 * A week fetched less than a minute ago is shown without asking the server
 * again, so a week prefetched a moment ago isn't fetched a second time when
 * you page to it. Older weeks show at once and refresh in the background.
 * (Changing a series invalidates the `['calendar']` keys, which refetches
 * whatever their age.) Both the visible week and the prefetches use it:
 * TanStack Query judges freshness by the setting of whoever is asking.
 */
const CALENDAR_STALE_MS = 60_000;

/** One shared empty list, so "no data yet" doesn't make the grid redo its layout on every render. */
const NO_OCCURRENCES: Occurrence[] = [];

const weekWindow = (monday: ISODate): DateWindow => ({ from: monday, to: addDays(monday, 6) });

export function CalendarScreen({
  leading,
  trailing,
  onOpen,
}: {
  /** Drawn at the start of the title bar (the logo). */
  leading?: ReactNode;
  /** Drawn at its end (the account menu). */
  trailing?: ReactNode;
  /** A block was tapped: passed straight to the grid. */
  onOpen?: (occurrence: Occurrence) => void;
}) {
  // In the cache already: the route's beforeLoad fetched it.
  const me = useSuspenseQuery(meQuery);
  const { profile, serverTime } = me.data;
  // An unknown zone would make every date function throw. Show UTC and say so.
  const zoneKnown = isKnownZone(profile.tzid);
  const zone = zoneKnown ? profile.tzid : 'UTC';
  const nowMs = useServerMinute(serverTime, me.dataUpdatedAt);
  const today = todayIn(zone, nowMs);

  const view: CalendarView = useMediaQuery(WEEK_VIEW_QUERY) ? 'week' : 'day';
  const [anchor, setAnchor] = useState<ISODate>(today);
  // "Today" bumps this to remount the grid, which scrolls it back to now.
  const [gridKey, setGridKey] = useState(0);

  const monday = mondayOf(anchor);
  const week = useMemo(() => weekDays(monday), [monday]);
  const days = useMemo(() => (view === 'week' ? week : [anchor]), [view, week, anchor]);

  // keepPreviousData: while a new week loads, keep the old answer instead of
  // going back to "loading", so the screen doesn't flash. The grid only draws
  // occurrences on the visible days, so the old week's blocks never show up
  // in the new week's columns.
  const calendar = useQuery({
    ...calendarQuery(weekWindow(monday)),
    staleTime: CALENDAR_STALE_MS,
    placeholderData: keepPreviousData,
  });
  const groups = useQuery(groupsQuery);

  const queryClient = useQueryClient();
  useEffect(() => {
    const range = navRange(today);
    for (const neighbour of [addDays(monday, -7), addDays(monday, 7)]) {
      if (!isWithin(neighbour, range)) continue;
      void queryClient.prefetchQuery({
        ...calendarQuery(weekWindow(neighbour)),
        staleTime: CALENDAR_STALE_MS,
      });
    }
  }, [monday, today, queryClient]);

  const groupsById = useMemo(() => {
    const byId: Record<string, GridGroup> = {};
    for (const group of groups.data?.groups ?? []) byId[group.id] = group;
    return byId;
  }, [groups.data]);

  // The session ended while the screen was open.
  if (isUnauthenticated(calendar.error) || isUnauthenticated(groups.error)) {
    return <Navigate to="/login" replace />;
  }

  const previous = stepAnchor(anchor, view, -1, today);
  const next = stepAnchor(anchor, view, 1, today);
  const unit = view === 'week' ? 'week' : 'day';
  const occurrences = calendar.data?.occurrences ?? NO_OCCURRENCES;

  let overlay: ReactNode = null;
  if (calendar.isPending) {
    overlay = <Notice role="status">Loading your week…</Notice>;
  } else if (calendar.isError && calendar.data === undefined) {
    const { title, message } = describeError(calendar.error);
    overlay = (
      <Notice role="alert">
        <span className="block font-medium">{title}</span>
        <span className="block text-slate-600 dark:text-slate-400">{message}</span>
        <button
          type="button"
          onClick={() => void calendar.refetch()}
          className="mt-2 rounded-lg bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:bg-indigo-500 dark:hover:bg-indigo-400"
        >
          Try again
        </button>
      </Notice>
    );
  } else if (!calendar.isPlaceholderData && occurrences.length === 0) {
    overlay = <Notice role="status">No classes this week</Notice>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* flex-wrap: a `trailing` item may ask for a line of its own (the offline badge on a phone). */}
      <header className="flex flex-wrap items-center gap-x-1 px-3 py-2 sm:gap-x-2">
        {leading}
        {/* Announced to screen readers when it changes, so Previous and Next say where they went. */}
        <h1
          aria-live="polite"
          className="ml-1 min-w-0 flex-1 truncate text-base font-semibold sm:text-lg"
        >
          {view === 'week' ? weekLabel(monday) : dayLabel(anchor)}
        </h1>
        {calendar.isFetching && !calendar.isPending && (
          <span
            role="status"
            className="size-4 shrink-0 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600 dark:border-slate-700 dark:border-t-indigo-400"
          >
            <span className="sr-only">Updating…</span>
          </span>
        )}
        <nav aria-label="Move through the calendar" className="flex shrink-0 items-center">
          <NavButton
            label={`Previous ${unit}`}
            disabled={previous === null}
            onClick={() => previous !== null && setAnchor(previous)}
          >
            <path d="m15 18-6-6 6-6" />
          </NavButton>
          <button
            type="button"
            onClick={() => {
              setAnchor(today);
              setGridKey((key) => key + 1);
            }}
            className="rounded-lg px-2.5 py-1.5 text-sm font-medium ring-1 ring-slate-300 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:ring-slate-700 dark:hover:bg-slate-800"
          >
            Today
          </button>
          <NavButton
            label={`Next ${unit}`}
            disabled={next === null}
            onClick={() => next !== null && setAnchor(next)}
          >
            <path d="m9 18 6-6-6-6" />
          </NavButton>
        </nav>
        {trailing}
      </header>

      {view === 'day' && (
        <DayStrip week={week} selected={anchor} today={today} onSelect={setAnchor} />
      )}

      {!zoneKnown && (
        <Banner>
          This browser doesn't know the zone “{profile.tzid}”, so times are shown in UTC.
        </Banner>
      )}
      {calendar.isError && calendar.data !== undefined && (
        <Banner>Can't reach the server. Showing this week as it was last loaded.</Banner>
      )}

      <div className="relative min-h-0 flex-1 border-t border-slate-200 dark:border-slate-800">
        <TimeGrid
          key={gridKey}
          days={days}
          zone={zone}
          occurrences={occurrences}
          groups={groupsById}
          nowMs={nowMs}
          pxPerMin={PX_PER_MIN[view]}
          onOpen={onOpen}
        />
        {overlay}
      </div>
    </div>
  );
}

/** A chevron button: Previous or Next. Disabled at the ±8-week limit. */
function NavButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-9 place-items-center rounded-lg hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-35 disabled:hover:bg-transparent dark:hover:bg-slate-800"
    >
      <svg
        viewBox="0 0 24 24"
        className="size-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {children}
      </svg>
    </button>
  );
}

/** Day view only: Monday to Sunday of the anchor's week, to jump to any day with one tap. */
function DayStrip({
  week,
  selected,
  today,
  onSelect,
}: {
  week: ISODate[];
  selected: ISODate;
  today: ISODate;
  onSelect: (day: ISODate) => void;
}) {
  return (
    <div className="grid grid-cols-7 gap-1 px-2 pb-2">
      {week.map((day) => {
        const { weekday, day: date } = dayHeader(day);
        const isSelected = day === selected;
        const isToday = day === today;
        let look = 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800';
        if (isSelected) look = 'bg-indigo-600 text-white dark:bg-indigo-500';
        else if (isToday)
          look = 'text-indigo-700 hover:bg-slate-100 dark:text-indigo-300 dark:hover:bg-slate-800';
        return (
          <button
            key={day}
            type="button"
            aria-label={longDayLabel(day)}
            aria-pressed={isSelected}
            aria-current={isToday ? 'date' : undefined}
            onClick={() => onSelect(day)}
            className={`flex flex-col items-center rounded-xl py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 ${look}`}
          >
            <span className="text-xs">{weekday}</span>
            <span
              className={`text-base tabular-nums ${isToday || isSelected ? 'font-semibold' : ''}`}
            >
              {date}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** A message over the grid: loading, empty, or failed. */
function Notice({ role, children }: { role: 'status' | 'alert'; children: ReactNode }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-24 flex justify-center px-4">
      <div
        role={role}
        className="pointer-events-auto max-w-xs rounded-xl bg-white/95 px-4 py-3 text-center text-sm shadow-sm ring-1 ring-slate-200 dark:bg-slate-900/95 dark:ring-slate-700"
      >
        {children}
      </div>
    </div>
  );
}

/** A one-line warning above the grid. */
function Banner({ children }: { children: ReactNode }) {
  return (
    <p
      role="status"
      className="mx-3 mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
    >
      {children}
    </p>
  );
}
