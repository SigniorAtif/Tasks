// Times are formatted in the zone passed in, so these pass whatever zone the
// machine is in; `pnpm test:tz` runs them under three to make sure.
import { describe, expect, it } from 'vitest';
import {
  blockDescription,
  dayHeader,
  dayLabel,
  hourLabel,
  longDayLabel,
  statusLabel,
  timeRangeLabel,
  weekLabel,
} from './format.ts';
import { occurrence } from './test-builders.ts';

const at = (iso: string) => Date.parse(iso);

describe('hourLabel', () => {
  it('counts 12, 1 … 11 with AM before noon and PM after', () => {
    expect([0, 1, 9, 11, 12, 13, 23].map(hourLabel)).toEqual([
      '12 AM',
      '1 AM',
      '9 AM',
      '11 AM',
      '12 PM',
      '1 PM',
      '11 PM',
    ]);
  });
});

describe('timeRangeLabel', () => {
  it('says AM or PM once when both ends share it', () => {
    expect(
      timeRangeLabel(at('2026-10-13T04:30:00Z'), at('2026-10-13T05:30:00Z'), 'Asia/Kolkata'),
    ).toBe('10:00–11:00 AM');
  });

  it('says both when the range crosses noon', () => {
    expect(
      timeRangeLabel(at('2026-10-13T06:00:00Z'), at('2026-10-13T07:00:00Z'), 'Asia/Kolkata'),
    ).toBe('11:30 AM–12:30 PM');
  });

  it("uses the display zone, never the machine's", () => {
    // The same moments, seen from New York.
    expect(
      timeRangeLabel(at('2026-10-13T04:30:00Z'), at('2026-10-13T05:30:00Z'), 'America/New_York'),
    ).toBe('12:30–1:30 AM');
  });

  it('follows daylight saving: a 13:00Z class is 9 AM in New York in October and 8 AM in December', () => {
    const ny = 'America/New_York';
    expect(timeRangeLabel(at('2026-10-13T13:00:00Z'), at('2026-10-13T14:00:00Z'), ny)).toBe(
      '9:00–10:00 AM',
    );
    expect(timeRangeLabel(at('2026-12-15T13:00:00Z'), at('2026-12-15T14:00:00Z'), ny)).toBe(
      '8:00–9:00 AM',
    );
  });
});

describe('date labels', () => {
  it('names a day for the header, the Day view and screen readers', () => {
    expect(dayHeader('2026-10-13')).toEqual({ weekday: 'Tue', day: 13 });
    expect(dayLabel('2026-10-13')).toBe('Tue 13 Oct');
    expect(longDayLabel('2026-10-13')).toBe('Tuesday 13 October');
  });

  it('names a week, saying a shared month and year once', () => {
    expect(weekLabel('2026-10-12')).toBe('12–18 Oct 2026');
    expect(weekLabel('2026-09-28')).toBe('28 Sep – 4 Oct 2026');
    expect(weekLabel('2026-12-28')).toBe('28 Dec 2026 – 3 Jan 2027');
  });
});

describe('statusLabel and blockDescription', () => {
  const ist = 'Asia/Kolkata';

  it('describes an ordinary class with its full subject, time, room and group', () => {
    const occ = occurrence({ title: 'DS', subject: 'Data Structures', location: 'C-301' });
    expect(statusLabel(occ)).toBeNull();
    expect(blockDescription(occ, ist, 'Classes · Sem 3')).toBe(
      'Data Structures, 10:00–11:00 AM, C-301, Classes · Sem 3',
    );
  });

  it('says why a class is cancelled, with the holiday when there is one', () => {
    const holiday = occurrence({
      status: 'cancelled',
      cancelReason: 'not_held',
      cancelOrigin: 'holiday',
      holidayLabel: 'Holiday (example)',
    });
    expect(statusLabel(holiday)).toBe('Cancelled');
    expect(blockDescription(holiday, ist)).toBe(
      'Data Structures, 10:00–11:00 AM, cancelled: Holiday (example)',
    );

    const skipped = occurrence({ status: 'cancelled', cancelReason: 'skipped' });
    expect(statusLabel(skipped)).toBe('Skipped');
    expect(blockDescription(skipped, ist)).toBe('Data Structures, 10:00–11:00 AM, skipped');
  });

  it('labels moved and extra classes, and reads out a note', () => {
    expect(statusLabel(occurrence({ moved: true }))).toBe('Moved');
    expect(statusLabel(occurrence({ extra: true, originalDate: null }))).toBe('Extra');
    expect(blockDescription(occurrence({ extra: true, note: 'Bring the lab manual' }), ist)).toBe(
      'Data Structures, 10:00–11:00 AM, extra class, note: Bring the lab manual',
    );
  });
});
