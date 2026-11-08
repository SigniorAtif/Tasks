// The calendar grid: hours down the side, one column per day, a block per
// occurrence. Render-only in v0.2: it draws what it's given and reports taps.
//
// `TimeGridProps` is the adapter boundary (D-076). The rest of the app only
// ever talks to the grid through these props, so the grid could be swapped
// for a library such as FullCalendar by writing a component that takes the
// same props, without touching the screen or the data code. Keep the props
// small: anything added here is something a replacement would also need.

import type { IanaZone, ISODate, Occurrence, ScheduleGroup } from '@tasks/core';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cssVars } from './css-vars.ts';
import { initialScrollMinute, minuteOfDayIn, todayIn } from './model/dates.ts';
import { dayHeader, hourLabel, longDayLabel } from './model/format.ts';
import { layoutDay } from './model/layout.ts';
import { type Segment, toSegments } from './model/segments.ts';
import { OccurrenceBlock } from './OccurrenceBlock.tsx';
import './time-grid.css';

/** What the grid needs to know about a group: its name (for screen readers) and colour. */
export type GridGroup = Pick<ScheduleGroup, 'id' | 'name' | 'colorToken'>;

export interface TimeGridProps {
  /** 1 (Day view) or 7 (Week view) consecutive dates, in order. */
  days: ISODate[];
  /** The display zone: the user's `profile.tzid`. Never the phone's own zone. */
  zone: IanaZone;
  /** What the server computed. Occurrences outside `days` are ignored. */
  occurrences: Occurrence[];
  /** Groups by id, for colours and names. A missing group draws in neutral grey. */
  groups: Record<string, GridGroup>;
  /** The server-corrected "now" in epoch ms (`serverNow` in lib/time.ts): the now line and today. */
  nowMs: number;
  /** Zoom: pixels per minute. 1 (60 px an hour) suits a phone; a bit more suits a desktop. */
  pxPerMin?: number;
  /** A block was tapped or clicked (or Enter pressed on it). */
  onOpen?: (occurrence: Occurrence) => void;
}

/** The hour labels down the side. 12 AM is left out: it would sit under the day header. */
const HOURS = Array.from({ length: 23 }, (_, i) => i + 1);

export function TimeGrid({
  days,
  zone,
  occurrences,
  groups,
  nowMs,
  pxPerMin = 1,
  onOpen,
}: TimeGridProps) {
  // Instants → per-day pieces → columns. Only redone when the data or the
  // days change, not on every minute tick.
  const columns = useMemo(() => {
    const byDay = new Map<ISODate, Segment[]>(days.map((day) => [day, []]));
    for (const segment of toSegments(occurrences, days, zone))
      byDay.get(segment.day)?.push(segment);
    return days.map((day) => ({ day, blocks: layoutDay(byDay.get(day) ?? []) }));
  }, [occurrences, days, zone]);

  const today = todayIn(zone, nowMs);
  const nowMinute = days.includes(today) ? minuteOfDayIn(zone, nowMs) : null;

  // Scroll once, before the first paint, so the grid opens at the right hour
  // instead of at midnight. The screen remounts the grid when "Today" is
  // tapped, which runs this again.
  const scroller = useRef<HTMLDivElement>(null);
  const [firstMinute] = useState(() => initialScrollMinute(nowMinute));
  useLayoutEffect(() => {
    if (scroller.current !== null) scroller.current.scrollTop = firstMinute * pxPerMin;
  }, [firstMinute, pxPerMin]);

  return (
    <div
      ref={scroller}
      className="tg h-full"
      style={cssVars({ '--px-per-min': pxPerMin, '--days': days.length })}
    >
      {/* Day names. A single day's name is already the screen's title. Hidden
          from screen readers, since each day's section is labelled in full. */}
      {days.length > 1 && (
        <div className="tg-head" aria-hidden="true">
          <div />
          {days.map((day) => {
            const { weekday, day: date } = dayHeader(day);
            return (
              <div key={day} className="tg-day-head" data-today={day === today || undefined}>
                <span>{weekday}</span>
                <span className="tg-date">{date}</span>
              </div>
            );
          })}
        </div>
      )}

      <div className="tg-body">
        <div className="tg-axis" aria-hidden="true">
          {HOURS.map((hour) => (
            <span key={hour} className="tg-hour-label" style={cssVars({ '--h': hour })}>
              {hourLabel(hour)}
            </span>
          ))}
        </div>

        {columns.map(({ day, blocks }) => (
          <section
            key={day}
            className="tg-day"
            aria-label={longDayLabel(day)}
            data-today={day === today || undefined}
          >
            {/* In time order, so Tab moves through the day from morning to night. */}
            {blocks.map((block) => (
              <OccurrenceBlock
                key={block.occ.key}
                block={block}
                zone={zone}
                group={groups[block.occ.groupId]}
                pxPerMin={pxPerMin}
                onOpen={onOpen}
              />
            ))}
            {day === today && nowMinute !== null && (
              <div className="tg-now" style={cssVars({ '--now': nowMinute })} aria-hidden="true" />
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
