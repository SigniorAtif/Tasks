// The timetable file format: what it accepts, what each line becomes, and that
// the committed sample file describes the same week as the engine's fixture.

import { describe, expect, it } from 'vitest';
import sample from '../../../fixtures/sample-timetable.json' with { type: 'json' };
import { timetable as fixture } from './recurrence/__fixtures__/sample-timetable.ts';
import { expand } from './recurrence/expand.ts';
import { createGroupSchema, createSeriesSchema } from './schemas.ts';
import { type TimetableFileInput, timetableFileSchema, timetableToRows } from './timetable.ts';
import type { ScheduleGroup, Series, Weekday } from './types.ts';

/** Ids that look like UUIDv7s and come out in order: 0199e0a8-0000-7000-8000-000000000001, … */
function counter(): () => string {
  let n = 0;
  return () => `0199e0a8-0000-7000-8000-${String(++n).padStart(12, '0')}`;
}

/** A file with one group and the given class lines. */
function file(classes: unknown[], group: Record<string, unknown> = {}): unknown {
  return {
    format: 'tasks.timetable',
    version: 1,
    tzid: 'Asia/Kolkata',
    groups: [{ name: 'Classes · Sem 3 (sample)', activeFrom: '2026-07-13', ...group, classes }],
  };
}

const ds = {
  title: 'DS',
  subject: 'Data Structures',
  location: 'C-301',
  day: 'MO',
  start: '08:00',
  end: '09:00',
};

/** Every problem as `path: message`, or `[]` when the file is accepted. */
function problems(input: unknown): string[] {
  const result = timetableFileSchema.safeParse(input);
  return result.success
    ? []
    : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
}

describe('timetableToRows', () => {
  it('makes one group and one weekly series per class line', () => {
    const parsed = timetableFileSchema.parse(file([ds]));
    expect(timetableToRows(parsed, counter())).toEqual({
      groups: [
        {
          id: '0199e0a8-0000-7000-8000-000000000001',
          name: 'Classes · Sem 3 (sample)',
          // Everything the file left out takes the create schema's default.
          colorToken: 'blue',
          activeFrom: '2026-07-13',
          activeTo: null,
          observesHolidays: true,
          attendance: true,
          attendanceThresholdPct: 75,
          attendanceTrackingFrom: null,
        },
      ],
      series: [
        {
          id: '0199e0a8-0000-7000-8000-000000000002',
          groupId: '0199e0a8-0000-7000-8000-000000000001',
          title: 'DS',
          subject: 'Data Structures',
          location: 'C-301',
          rule: { freq: 'weekly', interval: 1, byDay: ['MO'] },
          startDate: '2026-07-13',
          untilDate: null,
          startTime: '08:00',
          durationMin: 60,
          tzid: 'Asia/Kolkata',
        },
      ],
    });
  });

  it('turns a 14:00–16:00 lab into a 120-minute series, with its own dates and rhythm', () => {
    const lab = {
      title: 'Digital Systems Lab',
      location: 'Lab 5',
      day: 'TH',
      start: '14:00',
      end: '16:00',
      everyWeeks: 2,
      from: '2026-07-16',
      until: '2026-11-26',
    };
    const [series] = timetableToRows(timetableFileSchema.parse(file([lab])), counter()).series;
    expect(series).toMatchObject({
      title: 'Digital Systems Lab',
      // No subject in the file: attendance counts it under its title (B8).
      subject: 'Digital Systems Lab',
      rule: { freq: 'weekly', interval: 2, byDay: ['TH'] },
      startDate: '2026-07-16',
      untilDate: '2026-11-26',
      startTime: '14:00',
      durationMin: 120,
    });
  });

  it('makes rows the API create schemas accept unchanged', () => {
    const rows = timetableToRows(timetableFileSchema.parse(sample), counter());
    for (const group of rows.groups) expect(createGroupSchema.parse(group)).toEqual(group);
    for (const series of rows.series) expect(createSeriesSchema.parse(series)).toEqual(series);
  });
});

describe('timetableFileSchema', () => {
  it('accepts the smallest useful file', () => {
    expect(problems(file([ds]))).toEqual([]);
  });

  it('names the line and field of each problem', () => {
    const classes = [
      ds,
      { ...ds, day: 'Monday' },
      { ...ds, start: '8:00' },
      { ...ds, start: '10:00', end: '09:00' },
      { ...ds, end: '08:00' },
      { ...ds, title: '   ' },
      { ...ds, everyWeeks: 0 },
      { ...ds, from: '2026-09-01', until: '2026-08-31' },
    ];
    expect(problems(file(classes))).toEqual([
      'groups.0.classes.1.day: Invalid option: expected one of "MO"|"TU"|"WE"|"TH"|"FR"|"SA"|"SU"',
      // A bad start is reported once: the end isn't also blamed for it.
      'groups.0.classes.2.start: must be a time like 09:30',
      'groups.0.classes.3.end: must be after start, on the same day',
      'groups.0.classes.4.end: must be after start, on the same day',
      'groups.0.classes.5.title: must not be empty',
      'groups.0.classes.6.everyWeeks: Too small: expected number to be >=1',
      'groups.0.classes.7.until: must be on or after from',
    ]);
  });

  it("checks a line's last day against the group's first when it has no from", () => {
    const early = { ...ds, until: '2026-07-01' };
    expect(problems(file([ds, early]))).toEqual([
      'groups.0.classes.1.until: must be on or after activeFrom',
    ]);
    expect(problems(file([{ ...early, from: '2026-06-01' }]))).toEqual([]);
  });

  it('refuses unknown keys, so a typo or a newer version is never half-read', () => {
    const typo = file([{ ...ds, loaction: 'C-301' }]);
    expect(problems(typo)).toEqual(['groups.0.classes.0: Unrecognized key: "loaction"']);
    const holidays = { ...(file([ds]) as object), holidays: [] };
    expect(problems(holidays)).toEqual([': Unrecognized key: "holidays"']);
  });

  it('checks the header, the zone and the group', () => {
    const base = file([ds]) as Record<string, unknown>;
    expect(problems({ ...base, format: 'ics' })).toEqual([
      'format: Invalid input: expected "tasks.timetable"',
    ]);
    expect(problems({ ...base, version: 2 })).toEqual(['version: Invalid input: expected 1']);
    expect(problems({ ...base, tzid: 'IST' })).toEqual([
      'tzid: must be a time zone name like Asia/Kolkata',
    ]);
    expect(problems({ ...base, groups: [] })).toEqual(['groups: add at least one group']);
    expect(problems(file([ds], { activeTo: '2026-07-01' }))).toEqual([
      'groups.0.activeTo: must be on or after activeFrom',
    ]);
    expect(problems(file([ds], { colorToken: 'purple' }))[0]).toMatch(/^groups\.0\.colorToken: /);
  });

  it('refuses two groups with the same name', () => {
    const group = { name: 'Health', activeFrom: '2026-07-01', classes: [] };
    const twice = { ...(file([ds]) as object), groups: [group, { ...group }] };
    expect(problems(twice)).toEqual(['groups.1.name: is already the name of groups.0']);
  });

  it('types the file as written, defaults optional', () => {
    const written: TimetableFileInput = {
      format: 'tasks.timetable',
      version: 1,
      tzid: 'Asia/Kolkata',
      groups: [{ name: 'Health', activeFrom: '2026-07-01', classes: [] }],
    };
    expect(problems(written)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// fixtures/sample-timetable.json is the engine fixture's week, as a file
// ---------------------------------------------------------------------------

const ALL_DAYS: Weekday[] = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

interface Slot {
  group: string;
  title: string;
  location: string | null;
  day: Weekday;
  startTime: string;
  durationMin: number;
  interval: number;
  startDate: string;
  untilDate: string | null;
}

/** Splits series into one entry per weekday they run on, the way the file lists them. */
function slots(
  groups: readonly { id: string; name: string }[],
  series: readonly Pick<
    Series,
    'groupId' | 'title' | 'location' | 'rule' | 'startTime' | 'durationMin' | 'startDate'
  >[],
  untilOf: (index: number) => string | null,
): Slot[] {
  const nameOf = new Map(groups.map((g) => [g.id, g.name]));
  return series
    .flatMap((s, index) => {
      // A daily rule every 1 day is the same as weekly on all seven days.
      const days = s.rule.freq === 'weekly' ? s.rule.byDay : ALL_DAYS;
      return days.map((day) => ({
        group: nameOf.get(s.groupId) ?? '?',
        title: s.title,
        location: s.location,
        day,
        startTime: s.startTime,
        durationMin: s.durationMin,
        interval: s.rule.interval,
        startDate: s.startDate,
        untilDate: untilOf(index),
      }));
    })
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'));
}

describe('the sample timetable file', () => {
  const rows = timetableToRows(timetableFileSchema.parse(sample), counter());
  // As the API would store them: the create schemas' output, plus the server-side fields.
  const groups: ScheduleGroup[] = rows.groups.map((g) => ({
    ...createGroupSchema.parse(g),
    archivedAt: null,
  }));
  const series: Series[] = rows.series.map((s) => {
    const parsed = createSeriesSchema.parse(s);
    return { ...parsed, tzid: parsed.tzid ?? 'Asia/Kolkata', previousSeriesId: null };
  });

  it("has the fixture's two groups with the same ranges and settings", () => {
    const settings = (g: ScheduleGroup) => ({
      name: g.name,
      activeFrom: g.activeFrom,
      activeTo: g.activeTo,
      observesHolidays: g.observesHolidays,
      attendance: g.attendance,
    });
    expect(groups.map(settings)).toEqual(fixture.groups.map(settings));
  });

  it("lists every slot of the fixture's eight series: titles, days, times, rhythm, dates", () => {
    expect(fixture.series.every((s) => s.rule.freq === 'weekly' || s.rule.interval === 1)).toBe(
      true,
    );
    expect(slots(groups, series, (i) => series[i]?.untilDate ?? null)).toEqual(
      slots(fixture.groups, fixture.series, (i) => fixture.series[i]?.untilDate ?? null),
    );
    expect(series).toHaveLength(20);
  });

  it('expands to the same occurrences as the fixture over the whole semester', () => {
    const window = { from: '2026-06-29', to: '2026-12-06' };
    const seen = (input: Pick<Parameters<typeof expand>[0], 'groups' | 'series'>) =>
      expand({ ...input, overrides: [], dayExceptions: [], window })
        .map((o) => `${o.start} ${o.end} ${o.title} ${o.location ?? '-'} ${o.status}`)
        .sort();
    const fromFile = seen({ groups, series });
    expect(fromFile.length).toBeGreaterThan(300);
    expect(fromFile).toEqual(seen(fixture));
  });
});
