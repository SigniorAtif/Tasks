// A SAMPLE semester timetable, shaped like a KIIT week. It is not Atif's real timetable:
// that one arrives as fixtures/kiit-sem3.json in v0.2 (D-020) and replaces this.
// Week 2 is deliberately busy: a holiday, a move, a time change, a skip and a make-up class.
// Each week also has a note, one of them on a class the holiday cancels.

import { cancel, dayOff, extra, group, modified, move, series } from '../../test/builders.ts';
import type { ExpandInput } from '../expand.ts';

const sem = group({
  id: 'sem3',
  name: 'Classes · Sem 3 (sample)',
  activeFrom: '2026-07-13',
  activeTo: '2026-11-27',
  observesHolidays: true,
});
const health = group({
  id: 'health',
  name: 'Health',
  activeFrom: '2026-07-01',
  observesHolidays: false,
  attendance: false,
});

const cls = (
  id: string,
  title: string,
  byDay: ('MO' | 'TU' | 'WE' | 'TH' | 'FR')[],
  startTime: string,
  location: string,
  durationMin = 60,
) =>
  series({
    id,
    groupId: 'sem3',
    title,
    subject: title,
    location,
    rule: { freq: 'weekly', interval: 1, byDay },
    startDate: '2026-07-13',
    startTime,
    durationMin,
  });

export const timetable: Omit<ExpandInput, 'window'> = {
  groups: [sem, health],
  series: [
    cls('ds', 'Data Structures', ['MO', 'WE', 'FR'], '08:00', 'C-301'),
    cls('dm', 'Discrete Mathematics', ['MO', 'TU', 'TH'], '09:00', 'C-301'),
    cls('oop', 'OOP (Java)', ['TU', 'TH'], '10:00', 'C-204'),
    cls('dsd', 'Digital Systems', ['WE', 'FR'], '11:00', 'C-204'),
    cls('eco', 'Economics', ['TU'], '12:00', 'C-105'),
    cls('dsl', 'Data Structures Lab', ['MO'], '14:00', 'Lab 3', 120),
    series({
      id: 'dsdl',
      groupId: 'sem3',
      title: 'Digital Systems Lab',
      subject: 'Digital Systems Lab',
      location: 'Lab 5',
      rule: { freq: 'weekly', interval: 2, byDay: ['TH'] },
      startDate: '2026-07-16',
      startTime: '14:00',
      durationMin: 120,
    }),
    series({
      id: 'run',
      groupId: 'health',
      title: 'Evening run',
      subject: 'Evening run',
      rule: { freq: 'daily', interval: 1 },
      startDate: '2026-07-01',
      startTime: '18:00',
      durationMin: 45,
    }),
  ],
  overrides: [
    // Week 1
    cancel('ds', '2026-10-07', 'not_held'),
    modified('dsl', '2026-10-05', { note: 'Bring the lab manual' }),
    // Week 2
    move('dm', '2026-10-19', '2026-10-24', '10:00'),
    move('dsl', '2026-10-19', null, '15:00'),
    cancel('oop', '2026-10-22', 'skipped'),
    extra('makeup-oop', 'oop', '2026-10-24', '12:00'),
    modified('eco', '2026-10-20', { note: 'Essay still due today' }),
  ],
  dayExceptions: [dayOff('2026-10-20', 'not_held', 'Holiday (example)')],
};
