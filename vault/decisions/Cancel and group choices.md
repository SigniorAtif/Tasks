# Cancel and group choices

The choices behind v0.3: cancelling one class, and what a group is. They were settled by grilling (one question at a time, each with a recommended answer) on 2026-10-15, before any code. The short record is **ADR v0.3** in `JOURNEY.md`, and the words are defined in `CONTEXT.md` at the repo root. The engine these choices lean on is explained in [[Recurrence engine]], and the request style in [[Idempotency and retries]].

## Tapping a class acts on that one class

A tap opens an **occurrence sheet**: the title, date, time and room, the actions for its current state, and a link "Edit all DBMS…" to the series form. Until v0.3, a tap opened the series form directly.

"Cancel Tuesday's DBMS" is about one occurrence, while the series form changes every DBMS. Putting both in one screen invites "I meant only this one".

What lost: tap = cancel and long-press = series form (long-press is hard to find on a phone and awkward with a mouse), and cancel buttons inside the series form (it mixes "this one" with "all of them").

## Two attendance buttons with a fixed first word

In a group that tracks attendance, the sheet shows **Prof** (stored as `not_held`: the class didn't happen) and **Me** (stored as `skipped`: it happened, I didn't go). Under each, a small line rotates for fun ("bailed on us", "slept in"). Groups without attendance, like Health, get one "Not today", with no reason stored.

These two buttons decide the attendance percentage. You find a button by its first word at 8 am, so that word never changes, and the joke lives in the line under it. The database and the API only ever see the plain words.

What lost:
- Fully rotating labels. One day "I skipped" reads "Ghosted it", you tap the wrong one, and the number is silently wrong.
- "Prof bailed" / "I bailed": one word apart, easy to mis-tap.
- Plain labels everywhere: works, less fun.

## Restore keeps the note

A cancelled class offers **Restore** and **Change reason** at any time, and the 8-second Undo is the same as Restore. Restoring sets the cancel fields back to empty, and the override row is deleted only when *every* field on it is empty.

Example: Tuesday's DBMS has the note "bring lab manual", and you mark it skipped by mistake. Restore empties the cancel, and the note stays, because the row still holds something.

What lost: Undo deleting the row. It would delete the note too, and after 8 seconds a wrong tap couldn't be fixed.

## One request, keyed by the class's original slot

The phone sends `PATCH /api/v1/occurrences/:seriesId/:originalDate` with `{ "status": "cancelled", "cancelReason": "skipped" }`, and the server creates, updates or deletes the override row.

The phone doesn't need to know whether a row exists yet; it just says what should be true about that class. Sending the same request twice ends in the same state, so a retry after flaky Wi-Fi is harmless.

What lost: `POST …/cancel` and `POST …/restore` (two endpoints for one idea), and the phone working on override rows by their ids (an offline phone would have to know whether a row exists before it could write).

## Offline cancels: the last change wins

Cancel, restore and change reason are queued when offline. The stripes appear at once, with a small "waiting" mark. On reconnect the queue replays: a `404` (the series was deleted meanwhile) drops the change with a message, network errors and `5xx` retry, and a `401` waits until you sign in again.

The trade-off: if the phone (offline) says "skipped" and the laptop says "Prof cancelled" for the same class, whichever reaches the server last wins, and the other is lost without a word. Accepted: there's one user, it's rare, and detecting it needs version numbers on every row, which is the full sync the plan postpones (D-047). It's in JOURNEY's risks table.

What lost: no stripes until the server confirms. An offline cancel would look like it did nothing, and you'd tap it again.

## A group is a folder, with no first day

A group holds a name, a colour, an attendance setting and an optional **last day**. It has no first day. Each series has its own first and last day, and only those (plus the group's last day) decide where its classes appear.

Why the start went: the brainstorm made a group a semester switch, "Sem 3 runs 13 Jul – 27 Nov", and the engine hid every class before the group's start. That had two problems:
- Health has no dates at all.
- Make Health on 15 Oct, then add "Gym, since 1 Oct", and 1–14 Oct silently never show. Nothing tells you why.

What the form does instead: a *new* series suggests a first day, the earliest first day in the group that's still in the future, else today. It's only a suggestion in a box.
- Sem 4, made in December: type 5 Jan on the first series, and the next 20 suggest 5 Jan.
- Health with Running since 1 Oct, adding Gym on 21 Oct: Running's day is past, so it suggests today.
- Group g1 whose series start on the 17th, and an existing series A that starts on the 12th: putting A into g1 changes nothing about A. It shows from the 12th, the others from the 17th.

**Change group:** the series form's Group box moves a series to another group. The whole series goes, past included (old classes take the new colour), and the new group's last day applies. "Move" is kept for one occurrence.

What lost:
- Keeping the start, but only as that suggestion, stored as `default_start_date`. It goes stale: on 15 Oct, Sem 3's 13 Jul would suggest a July start for a new tutorial, so it needs a "future only" fallback anyway, after which it never does anything again.
- Archiving the series behind the scenes at the group's start: the same picture, with extra rows.
- The brainstorm's version, with the hiding bug above.

## "Archived" is worked out from the last day

A group or series is archived once its last day has passed; nothing stores a separate "archived" flag. **Archive** sets the last day to today (or keeps an earlier one). Archived groups leave the pickers and sit in an Archived section.

One field can't disagree with itself. With a flag *and* a date, you could have "archived" with no end, or an end that passed without being "archived". "Sem 3 ends 27 Nov" archives itself on the 28th.

The catch: a series that hasn't started can't be archived, because its last day (today) would come before its first day, which the database refuses. It only offers Delete, and with nothing to lose, that's a plain confirm.

## A last day in the past hides, never erases

On 1 Dec you set Sem 3's last day to 20 Nov. Plain classes after it just stop showing. If any have something on them (a cancel, a note, a move), one line warns: "3 changes after 20 Nov will stop showing. They're kept: set the date back and they return."

Why a count and not a list? A list with links exists to let you rescue things before they're destroyed, and nothing is destroyed here. The rows stay in the database, and the engine already treats them as *dormant* (`findOrphans` in `packages/core/src/recurrence/expand.ts` says so), so moving the date back brings them back.

What lost: erasing them (no way back), and a list with a link to each (a rescue for something that isn't at risk).

## Delete: type the name

Delete always offers **Archive instead** first. If there's history, you type the name to confirm, ignoring case, spaces and symbols, so "classes sem 3" matches "Classes · Sem 3" (the `·` is hard to type on a phone). With nothing to lose, like an empty group made by mistake, it's a plain confirm.

The name is what beats muscle memory. A long "I understand…" sentence adds typing, not safety.

## Moves show where they landed (built in v0.3b)

A moved class is saved as one row filed under its old spot: "DBMS from Mon 24 Nov now happens Wed 19 Nov 14:00". From v0.3b, the calendar draws it from where it **landed**, like an extra, and the old spot only decides whether to draw the faded ghost. Moves and extras are hidden only by their group's last day.

If the calendar found moves by walking the rule to the old spot, the class would vanish whenever the rule stopped reaching it: after a split to Tue/Thu (no more Mondays), or when Sem 3's last day is set to 20 Nov (the 24th is never reached, though the 19th is inside the semester).

What lost: the brainstorm's rule plus a patch that turns the move into an extra during a split. It fixes the split case, not the last-day one.

## Humour with a rule

Rotating lines appear in toasts, loading, empty days and the sync badge, from `apps/web/src/lib/quips.ts`, with the same line all day. There are three easter eggs: every class today cancelled, a rare loading line that rolls its chance each time, and a gentle roast after three skips in one day.

The rule exists because a joke you see 300 times a semester wears out, and a joke on a button that changes a number is a bug.

## What moved out of v0.3

| Item | Where it went | Why |
|---|---|---|
| Nightly backups and a restore drill | The server setup (later list) | They need a server, which isn't set up yet |
| Notes on one occurrence | v0.3b | Not part of the demo (the stripes) |
| Moves, splits, the semester swap, days off, conflicts | v0.3b, grilled separately | Built in pieces: v0.3 first, then grill v0.3b, then build it |

## Check yourself
- Health has Running since 1 Oct. On 21 Oct you add Gym but you really started on 1 Oct. What does the form suggest, what do you change, and why does nothing hide 1–20 Oct?
- Why are the two attendance buttons allowed a rotating line but not a rotating first word?
- You restore a skipped class that has a note. Which row is deleted, and why not this one?
- On 1 Dec you set Sem 3's last day to 20 Nov, then change your mind and set it back to 27 Nov. What happens to the skip you had marked on 25 Nov, and which function's comment tells you so?
- A class was moved from Mon 24 Nov to Wed 19 Nov. Sem 3's last day becomes 20 Nov. Under the old rule and under the v0.3b rule, is the class on the 19th visible?
