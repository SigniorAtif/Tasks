# Groups screen choices

The choices made while building ticket #11, the Groups screen. The ticket set the shape: a route from the account menu, running groups first and an Archived section after, each sorted by name; "archived" worked out by one helper in core that honours the profile's zone and day boundary; a form for name, colour, attendance and last day. Everything below filled the gaps around it. PR #21 lists them. How the code does it: [[Groups screen]], [[The user's day]], [[Shared form pieces]].

## "Today" starts at midnight, and follows the profile's day boundary

A group is archived once its last day is before **your day**: the date in your profile's zone, starting at your day boundary. The boundary is midnight by default, so a group that ends on Fri 27 Nov is archived from 00:00 on Saturday.

Why one rule: the Groups screen and the series form can never disagree about whether Sem 3 has ended. Why it follows the profile's boundary: the setting has been in the profile since v0.0 (D-035), and the ticket asked for it.

Why midnight by default: D-035 chose 04:00, so that a late night stays one day: at 00:30 after Sem 3's last day, still Friday for you, Sem 3 would still be running. #11 was first built that way. Then, at 02:14 one night, the calendar showed the 10th as today while the series form suggested the 9th as a new class's first day, and the Groups screen listed a group that ended on the 9th as running. The calendar's dates change at midnight, as a grid of dates has to, so a 04:00 day put two different "todays" on screen for four hours every night. Midnight makes them agree. The boundary stays a setting, so a later start can come back with a settings screen. Migration `0004` moved every profile still on 04:00, because nothing in the app could set it yet, so none of them was a choice.

What lost:
- **04:00 by default.** A class at 01:00 after a late night counts as the evening before, as D-035 wanted, at the price of two "todays" on screen between midnight and 04:00.
- **Making the calendar follow the 04:00 day instead.** Its highlighted day would be yesterday's column until 04:00 while the clock reads the new date: the same mismatch, moved.
- **Hard-coding midnight**, as #7's stand-in did (`todayIn`). The same answer today, but it ignores the profile's setting, so a later start could never come back without touching every screen.
- **The phone's own date.** Simplest of all, and wrong whenever the phone's zone isn't the profile's: on a laptop set to London, a Kolkata user's group would end five and a half hours late.

## One helper, in core, that takes "today" as an argument

`isArchived(item, today)` and `localDateOf(epochMs, tzid, dayBoundary)` live in `packages/core/src/days.ts`. The web app's `todayFor(profile)` supplies "now".

Why: the ticket asked for one helper every screen shares, and core is where code goes that both apps can use. If the API ever needs the same answer, it imports the same function. Core never reads the clock (D-015), so the moment comes in as a number; that's also what lets the tests check 03:59 and 04:00 on a fixed date, and a daylight-saving night, without faking the clock.

What lost:
- **Each screen working it out.** Two copies of "last day before today" drift: one gets `<=`, and Sem 3 is archived on the Groups screen but still offered by the series form.
- **A helper that reads the clock itself** (`isArchived(group)` with no `today`). Shorter to call, but core would need the `Date` global, and every test would need a fake clock.

## Sorted in the browser, with numbers counted

The Groups screen and the series form's select both sort with `Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })`, so "Sem 9" comes before "Sem 10", and "art club" sits among the A's.

Why: the server already sorts by name, but Postgres compares text character by character, so "Sem 10" (`1`) beats "Sem 9" (`9`). Semester names are the main thing in this list, and "Sem 10" above "Sem 9" reads as a bug. Sorting again in the browser costs nothing for a few dozen groups and gives one order on every screen.

What lost:
- **Postgres's order, as it comes.** No code at all, and wrong for exactly the names this app has.
- **A numeric collation in Postgres** (an ICU collation with numeric ordering, used in the `ORDER BY`). It would fix the order at the source, but needs a migration, depends on the database's ICU support, and every screen still has to keep the order when it filters or merges lists.
- **Sorting only on the Groups screen.** Then the series form's select would show a different order from the screen next to it.

## The "(archived)" label stays in the series form

An archived group leaves the series form's Group select, except the group the class is already in, which stays, marked "(archived)". #7's comment asked for its stand-in `isArchived` "and its '(archived)' label" to be replaced. The stand-in is gone; the label now asks core's helper.

Why: removing the label would leave a class in an ended group showing a select that looks like an ordinary choice, or, without the option at all, a select with nothing chosen, which would quietly move the class on the next Save. The label was never the problem; the midnight rule behind it was.

What lost: dropping the label, which is what the comment could be read as asking. Noted in PR #21.

## The group form is a screen, not a sheet

`/groups/new` and `/groups/<id>` are screens of their own, like `/series/new` and `/series/<id>`.

Why: the back button and a shared link work with no extra code, and the form has room to grow: Archive and Delete come below the Save row in #12 and #14, with a confirm step each. It also matches the series form, so the two can share their pieces.

What lost:
- **A sheet over the list**, like the occurrence sheet. Faster to open and close, but a sheet with four fields, two future danger buttons and a keyboard open is cramped at 412 px, and the back button would leave the whole screen.

## Share the series form's pieces before writing the second form

The field frame, the colour swatches, the banner, the Save row, the screen frame and the error-to-field code moved into `components/` and `lib/` first, in a commit of their own that changes nothing on screen. Then the group form used them.

Why: the group form needs every one of them. A copy would have meant two versions of "turn a 422 into a message under the right field", "move the focus to the first problem" and "Save is off while offline", which would drift: fix the focus in one form and the other keeps the bug. Doing it as its own commit, before the group form, kept it reviewable: that commit should change nothing, and the series form's tests and the end-to-end test show it doesn't.

What lost:
- **Copying, and sharing later** (when a third form arrives). A smaller first PR, but the second copy would have been written and reviewed only to be deleted.
- **A form library** (React Hook Form, TanStack Form). Fewer lines of our own, but a new dependency with its own model of state and errors, for two small forms that already work.

## Save goes back to Groups, and an edit sends only what changed

After Save the app returns to the list. An edit sends only the fields that differ from what the form opened with; nothing changed sends nothing.

Why: you usually open a group to change one thing, so landing back on the list shows the result (a new colour, a new "Last day") at once. Sending only the changes means that changing the colour on your phone doesn't undo a rename you made on the laptop a minute before. Both match the series form.

What lost:
- **Staying on the form** with a "Saved" toast. Useful when you change several things in a row; here you'd tap back every time.
- **Sending the whole group** on every edit. Simpler to write, and it overwrites changes made elsewhere.

## Not in this ticket

- **The calendar's own "today"** turns at midnight, which now matches the default. Making it follow a later boundary waits until something can set one.
- **"Observes holidays"** stays hidden until days off exist (v0.3b).
- **Archive and Delete** come in #12 and #14.

## Check yourself

- Name the one rule that decides "archived". With a 04:00 boundary, give a moment when it and the calendar disagree about Sem 3 ending on 27 Nov, and say why the default moved to midnight.
- Why does `isArchived` take `today` as an argument instead of reading the clock?
- Postgres already sorts groups by name. Why sort again in the browser, and why on the series form too?
- What could go wrong if the series form dropped an archived group from its select even when the class is already in it?
