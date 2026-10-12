// Golden files: the engine's output for whole weeks, written as plain text you can read
// and check by eye. Vitest compares every run against the saved file, so any change in
// behaviour shows up as a readable diff. Update on purpose with `vitest -u`, after checking
// the new text is right.

import { Temporal } from 'temporal-polyfill';
import { describe, expect, it } from 'vitest';
import type { Occurrence } from '../types.ts';
import { timetable } from './__fixtures__/sample-timetable.ts';
import { expand } from './expand.ts';

// Fixed names, not toLocaleString: a golden file must not depend on the machine's locale.
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const clock = (instant: string, tzid: string) =>
  Temporal.Instant.from(instant)
    .toZonedDateTimeISO(tzid)
    .toPlainTime()
    .toString({ smallestUnit: 'minute' });

function describeOccurrence(o: Occurrence): string {
  const labels: string[] = [];
  if (o.status === 'cancelled') {
    labels.push(
      ['cancelled', o.cancelReason ?? 'no reason', o.holidayLabel].filter(Boolean).join(' · '),
    );
  }
  if (o.moved) labels.push(`moved (originally ${o.originalDate})`);
  if (o.extra) labels.push('extra');
  if (o.dstShifted) labels.push('DST-shifted');
  if (o.note) labels.push(`note: ${o.note}`);
  const time = `${clock(o.start, o.tzid)}–${clock(o.end, o.tzid)}`;
  return `  ${time}  ${o.title.padEnd(22)}${(o.location ?? '').padEnd(8)}${labels.join('; ')}`.trimEnd();
}

function week(monday: string): string {
  const from = Temporal.PlainDate.from(monday);
  const to = from.add({ days: 6 });
  const occs = expand({ ...timetable, window: { from: from.toString(), to: to.toString() } });
  const lines = [
    `SAMPLE timetable, not the real one yet. Week of ${monday}, times in Asia/Kolkata.`,
  ];
  for (let d = from; Temporal.PlainDate.compare(d, to) <= 0; d = d.add({ days: 1 })) {
    lines.push('', `${DAY_NAMES[d.dayOfWeek - 1]} ${d}`);
    const today = occs.filter((o) => o.date === d.toString());
    lines.push(...(today.length > 0 ? today.map(describeOccurrence) : ['  (nothing)']));
  }
  return `${lines.join('\n')}\n`;
}

describe('golden weeks (sample timetable)', () => {
  it('an ordinary week with one prof cancellation', async () => {
    await expect(week('2026-10-05')).toMatchFileSnapshot(
      './__snapshots__/sample-week-2026-10-05.txt',
    );
  });

  it('a busy week: holiday, move, time change, skip and a make-up class', async () => {
    await expect(week('2026-10-19')).toMatchFileSnapshot(
      './__snapshots__/sample-week-2026-10-19.txt',
    );
  });
});
