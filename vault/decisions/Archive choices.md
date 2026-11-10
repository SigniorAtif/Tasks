# Archive choices

The choices made while building ticket #12, Archive and last days. The spec (#6, ADR v0.3) set the shape before any code: "archived" is worked out from the last day, never stored; Archive sets the last day and never extends it; a last day in the past hides changes and never erases them; the form says how many before saving; the count comes from a read, `GET .../impact`, that #14 will extend. Everything below filled the gaps, and one choice was changed after the first PR merged. PR #22 and PR #23 list them. How the code does it: [[Archive and last days]]. The decisions behind the shape: [[Cancel and group choices]].

## Archive ends things yesterday, not today

Archive sets the last day to **yesterday**, so the day you archive doesn't count. Archive "Sem 3" on Tue 10 Nov and its last day becomes Mon 9 Nov; it's under Archived at once.

The spec said today, and PR #22 built today. Trying it showed the cost: a group you'd just archived stayed in the running list, reading "Last day 10 Nov 2026", and stayed in the series form's Group select, until the next morning. Archive looked like it hadn't worked. And today's classes still counted, though you'd just said this was over. So, after seeing it, Archive moved to yesterday: the day you archive doesn't count. PR #23 changed one line of `archiveDay`, the copy under the button, and the ADR bullet.

The price: a class that starts **today** can no longer be archived, because yesterday would come before its first day, which the database refuses. It offers only Delete, which for a class with nothing on it yet is the right tool anyway.

What lost:
- **Today**, as the spec said. One day of "archived but still listed as running", every time.
- **Today, but shown as archived at once.** A second rule beside "last day before today", which is exactly the two-answers problem the derived "archived" exists to avoid.
- **Asking for a date.** The Last day field already does that; Archive is the one-tap version.

## Archive shows only when it changes something

`archiveDay` answers `undefined` when the group or class already ends by yesterday (its own last day or, for a class, its group's), or when a class starts today or later. The forms then leave Archive out.

Why: "the earlier of the current last day and yesterday" means Archive does nothing for something already over, and a button that does nothing is noise. It also closed a real bug found in review: with the *saved* last day as input, typing 30 Oct and then tapping Archive saved 10 Nov, moving the end later. Now the typed date goes in, and a typed date already in the past makes Archive disappear.

What lost:
- **Always showing it, greyed out with a reason.** More to read on every ended group, for a button nobody needs there.

## One tap saves the whole form

Archive saves through the same `submit` as Save, with the new last day swapped in, then leaves the form. It's an ordinary `PATCH`.

Why: Archive is a last-day edit, so it should behave like one. If you'd renamed the group a moment before, the rename goes too, instead of being silently dropped when the form closes. No confirm step: nothing is lost, and clearing the last day undoes it. The line under the button says what it will do, and how many changes it will hide, before you tap.

What lost:
- **A separate request with only `untilDate`.** It would leave other unsaved edits on a form that's about to close.
- **A confirm dialog.** A tap of friction for something two taps undo.

## The count comes from the server

The forms ask `GET /api/v1/groups/<id>/impact?lastDay=…` (or `/series/<id>/impact`), answered with `{ "changesAfter": 2 }`.

Why: the phone holds only the weeks it has loaded, and a change can be on any date. A cancel you made for next March is real, but the phone may never have loaded March, so a count worked out on the phone would quietly miss it. The server can load every override of the classes in one query.

What lost:
- **Counting on the phone.** No new route, and wrong by omission.
- **Sending every override to the phone** so it can count. A bigger answer and a second copy of the data to keep fresh, for one number.

## The count asks the engine

`stopShowing` sits next to `findOrphans` in the engine and asks `occursOn`, the engine's own rule, whether each change shows now and with the new last day. Extras use `extraShows`, which `expand()` now calls too.

Why: the warning says what the calendar will stop drawing, so it has to use the calendar's rules. If the two disagreed, the form would promise "3 changes" and the calendar would hide 2. One function means they can't.

What lost:
- **A SQL count**, `where original_date > $lastDay`. One line, and wrong in four ways: it counts extras that a class's own last day doesn't hide, counts changes already hidden, ignores the series' rule (a cancel on a date an every-2-weeks rule no longer makes), and drifts the first time the engine changes.

## The count is relative: what shows now, and wouldn't

Only changes that show now and wouldn't with the new date are counted.

Why: the warning is news about what's about to disappear. A cancel already hidden by an earlier last day isn't news; counting it would make a *later* last day say "3 changes will stop showing" when the change actually brings things back.

What lost:
- **Everything after the date.** Simpler to explain, and it warns on exactly the move that hides nothing.

## Moves are counted by their original date, until v0.3b

A moved class is counted by the date it was moved from, because that's how the engine places it today. From v0.3b moves show where they landed (ADR v0.3), and `stopShowing` has to change with `expand()`. Both the code and the later list say so.

## The count is never kept

The impact query has `gcTime: 0`, isn't in the offline copy, and uses `skipToken` until there's both a saved row and a date.

Why: everything else the app reads is kept forever and saved for offline, because old data beats a blank screen ([[Offline reads]]). A count is the opposite: it goes stale the moment someone cancels a class, and a stale number flashing before the fresh one is worse than a moment with none. Offline, writes are off, so there's nothing to warn about.

What lost:
- **The app's default** (`gcTime: Infinity`, saved for offline): yesterday's count shows first, then jumps.

## The wording

The spec's sentence was "3 changes after 20 Nov will stop showing. They're kept: set the date back and they return." The built one is "3 changes after 20 Nov 2026 will stop showing. A later date brings them back.": shorter, with the year, like every date on the forms, and the same promise. It sits in a polite live region under the Last day field, amber, because it's a fact about the date, not an error. Save still works.

## Not in this ticket

- **Delete** (#14) asks the same read without a date, for `hasHistory`. Without `lastDay` the count is 0, ready for it. Archive's button repeats Delete's classes; #14 brings Delete to the group form, which is the moment to share them.
- **Warnings for a new first day or a new timing** (#13) extend the read with more of the series' fields. `stopShowing` needed no change: given the whole proposed series, it already accounts for them. See [[Series warning choices]].

## Check yourself

- Why did Archive change from today to yesterday, and what can't be archived any more because of it?
- You typed 30 Oct into the Last day field on 10 Nov. Why is Archive gone, and what bug did that fix?
- Give one change a `where original_date > $lastDay` count would get wrong, and say why the engine gets it right.
- A group's last day is 1 Nov. You move it to 20 Nov. What does the warning say, and why?
- Why does the count skip the offline copy, when every other read is kept forever?
