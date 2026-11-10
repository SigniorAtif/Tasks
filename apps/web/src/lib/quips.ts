// The app's voice: a line of humour in the toasts, the loading notices, an
// empty day, the offline badge, the delete question and under Prof and Me.
// Every line lives here, and nothing here is ever saved or sent: stored data
// and the API keep plain words ("Prof cancelled", "I skipped").
//
// Each moment says the same line all day, so a redraw never swaps the joke.
// The day is the user's day (`todayFor`), which starts at their day boundary:
// a line read at 1 am is still yesterday's when the day starts at 4.
//
// One rule the callers keep: a quip is never the first word of a button that
// changes a number. Prof, Me, Not today, Restore and Delete always say that.

import type { ISODate, Occurrence } from '@tasks/core';

const LINES = {
  /** Under Prof: still has to say the class didn't happen. */
  prof: [
    "Class didn't happen",
    'They never showed',
    'Called off',
    'Nobody taught',
    'The podium stayed empty',
    'Cancelled on us',
    'The prof took the day',
    'No class, not my doing',
  ],
  /** Under Me: still has to say I didn't go. */
  me: [
    "I didn't go",
    'I stayed in bed',
    'I had better plans',
    'Skipped it',
    'I was elsewhere',
    'I took the day',
    'My call, my absence',
    'Not my finest hour',
  ],
  /** The toast after Prof. */
  cancelledByProf: [
    'A free hour. Spend it badly.',
    'Not your fault. Enjoy it.',
    'The best kind of class.',
    'Attendance survives another day.',
    'Somebody up front slept in.',
    'Unplanned freedom is still freedom.',
    'Nothing taught, nothing lost.',
    'An hour back, no questions asked.',
  ],
  /** The toast after Me. */
  skipped: [
    'Bold. The percentage noticed.',
    'No judgement. Some judgement.',
    'Rest is also a subject.',
    'Your bed sends its thanks.',
    'Hope it was worth the hour.',
    'The notes will find you. Probably.',
    'Counted. Honesty suits you.',
    'One more for the wrong column.',
  ],
  /** The toast after Not today, where nobody counts. */
  notToday: [
    'Off the list for today.',
    'Tomorrow can have it.',
    "Nobody's counting this one.",
    'Skipped, guilt not included.',
    'The day just got lighter.',
    "It'll be there next time.",
    'Postponed by decree.',
    'One thing fewer. Good.',
  ],
  loading: [
    'Fetching your week…',
    'Asking the server nicely…',
    'Finding out what the week owes you…',
    'Lining up the classes…',
    'Counting the Mondays…',
    'Unfolding the timetable…',
    "Checking who's teaching…",
    'One moment. The week is heavy…',
  ],
  /** Under "No classes today" or "No classes this week". */
  emptyDay: [
    'Nothing owed to anyone.',
    'Sleep in. Officially.',
    "Free, and nobody's checking.",
    'Not a single bell.',
    'The timetable blinked first.',
    "A blank page. Don't fill it.",
    'Rare. Use it well, or not.',
    'The calendar has no notes.',
  ],
  /** After "offline" or "can't sync" in the badge: short, it's a pill. */
  badge: [
    'working from memory',
    'saved here meanwhile',
    'carrying on regardless',
    'the server can wait',
    'nothing lost',
    'your move, server',
    'patience, mostly',
    'still yours to use',
  ],
  /** Under "Delete this class?". */
  confirmDelete: [
    'Gone means gone.',
    'No undo lives here.',
    'Think once more. Then decide.',
    'The calendar forgets completely.',
    "This one doesn't come back.",
    'Final answer?',
    'Measure twice, delete once.',
    'The trash has no bottom.',
  ],
  // The easter eggs: fewer lines, since each shows up rarely.
  /** Above the calendar when every class today is cancelled. */
  allCancelled: [
    'Every class today, cancelled. Go outside.',
    'A clean sweep. Today is yours.',
    'Nothing left standing today.',
    'The whole day, called off. Savour it.',
  ],
  /** The toast after the third skip of one day, instead of the usual line. */
  threeSkips: [
    'Three skips in one day. A hat-trick nobody claps for.',
    'Three in a day. The timetable is now a suggestion.',
    "That's three. Was it the classes, or the bed?",
    'Three skips. Brave, for someone with a percentage.',
  ],
  /** Once in a long while, instead of the loading line. */
  rareLoading: [
    'Loading. Faster than your last assignment…',
    'You opened this quicker than your notes…',
    'Still loading. Still more punctual than you…',
  ],
} as const satisfies Record<string, readonly string[]>;

/** A place in the app that has a line of its own. */
export type Moment = keyof typeof LINES;

const MOMENTS = Object.keys(LINES) as Moment[];
const DAY_MS = 86_400_000;

/**
 * The moment's line for `day` (the user's day, `todayFor`). The lines take
 * turns, one per day, so the same day always gives the same line and no line
 * comes back until the others have had theirs. Each moment starts its turn at
 * a different place, so two moments on one screen don't move in step.
 */
export function quip(moment: Moment, day: ISODate): string {
  const lines = LINES[moment];
  // Days since 1970: a count that goes up by one each day, month ends included.
  const dayNumber = Math.floor(Date.parse(`${day}T00:00:00Z`) / DAY_MS);
  return lines[(dayNumber + MOMENTS.indexOf(moment)) % lines.length] ?? lines[0];
}

/** How often a loading notice says a rare line: about one time in forty. */
export const RARE_LOADING_CHANCE = 0.025;

/**
 * The line for a loading notice. `roll` is a fresh `Math.random()` for each
 * notice: under the chance it's a rare line, otherwise the day's usual one.
 */
export function loadingQuip(day: ISODate, roll: number): string {
  return quip(roll < RARE_LOADING_CHANCE ? 'rareLoading' : 'loading', day);
}

/** What the easter eggs read of an occurrence. */
type DatedOccurrence = Pick<Occurrence, 'key' | 'date' | 'status' | 'cancelReason'>;

/**
 * Whether every class on `day` is cancelled, for any reason. A day with no
 * classes is just an empty day: there was nothing to cancel.
 */
export function everyClassCancelled(
  occurrences: readonly DatedOccurrence[],
  day: ISODate,
): boolean {
  const classes = occurrences.filter((occ) => occ.date === day);
  return classes.length > 0 && classes.every((occ) => occ.status === 'cancelled');
}

/** Skips on one day before the roast. */
const SKIPS_FOR_ROAST = 3;

/**
 * The line for the toast after a cancel. `cancelled` is the class as it now
 * stands, `shown` the calendar as it was before the change. A skip that makes
 * three or more on that class's own day (which needn't be today) gets the
 * roast instead of the day's line.
 */
export function cancelQuip(
  cancelled: DatedOccurrence,
  shown: readonly DatedOccurrence[],
  day: ISODate,
): string {
  if (cancelled.cancelReason === 'not_held') return quip('cancelledByProf', day);
  if (cancelled.cancelReason !== 'skipped') return quip('notToday', day);
  const otherSkips = shown.filter(
    (occ) =>
      occ.key !== cancelled.key &&
      occ.date === cancelled.date &&
      occ.status === 'cancelled' &&
      occ.cancelReason === 'skipped',
  ).length;
  return quip(otherSkips + 1 >= SKIPS_FOR_ROAST ? 'threeSkips' : 'skipped', day);
}
