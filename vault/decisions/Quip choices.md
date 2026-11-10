# Quip choices

The choices made while building ticket #15, Quips. The spec (#6, user stories 9, 10 and 50 to 53, edge case 9) set the shape: one module, about eight lines per moment, the same line all day, three easter eggs, and never on a button that changes a number. Everything below filled the gaps; the first-draft gaps found in code review are marked. PR #26 lists them. How the code does it: [[Quips]]. The earlier decision this builds on: [[Cancel and group choices]].

## The lines take turns

The day's line is the count of days since 1970, plus the moment's place in the list, divided by the number of lines, keeping the remainder.

Why: it gives the same line all day with nothing to store, and tomorrow is always a different line. With eight lines, no line comes back for eight days.

What lost:
- **A random pick, remembered for the day.** Needs somewhere to remember it (the phone's storage), and one more thing to clear and to get out of step between two devices.
- **A hash of the date.** Also the same all day, but a hash scatters: the same line can come up two days running, which reads as a stuck app.
- **Random on every draw.** The flicker the spec forbids: the joke changes each time the screen redraws.

## The day is the user's day

Every quip is picked from `todayFor(profile, now)`, the day that starts at the profile's day boundary.

Why: edge case 9 says so, and it is the same day Archive and Delete already use ([[The user's day]]). The ticket says "(04:00)", which was the default when it was written; the default moved to midnight in ticket #11, so the rule is "the profile's boundary", whatever it is.

What lost:
- **The phone's midnight.** One line of code less, and wrong for anyone who sets a later day start: the joke would change at midnight while their day carries on.

One gap is left open on purpose: the calendar's own "today" still changes at midnight, so with a later boundary the words "No classes today" and the quip under them could disagree for a few hours. Nobody can set a boundary yet. It is on the later list for when a setting exists.

## The joke sits under the fact

A toast's `text` is still "Pottery · I skipped". The quip is a second, smaller line.

Why: the toast is how you learn what the tap did, and Undo depends on understanding it. A joke in place of the fact turns a slip into a mystery.

What lost:
- **The quip as the toast's text.** "Rest is also a subject." alone doesn't say which class, or what happened to it.
- **The quip joined on with a dot.** One long line that wraps on a phone, with the fact and the joke at the same weight.

## Some toasts stay plain

Only the toast after a cancel has a quip. The toast for a change the server refused has none.

Why: that toast says your change was lost. A joke there reads as the app laughing at you.

What lost:
- **A quip on every toast.** It matches the ticket's words ("wired into the toasts") more literally and gets the tone wrong in the one case that matters.

## The roast counts the class's own day

Three skips on the date of the class just skipped, whichever date that is.

Why: "three skips in one day" is about one day's classes. Skipping three of Friday's classes on Thursday night is the same decision as doing it on Friday.

What lost:
- **Only today's classes.** Simpler to say, and it would miss the planned skip, which is the one more worth a raised eyebrow.
- **Counting every cancel.** Three classes the prof cancelled would be roasted as if you'd done it.

Found in review: the first roast line said "Three skips today", which is wrong when the classes are on another day. It now says "in one day".

## Screen readers hear "Loading…"

The loading quip is `aria-hidden`, and a plain "Loading…" sits beside it for screen readers.

Why: someone listening needs to know the screen is waiting. "Counting the Mondays…" doesn't say that, and the rare lines say it even less. Found in review: the first draft read the joke out and dropped "Loading…".

What lost:
- **Read the joke aloud.** Equal treatment in theory; in practice the listener gets a riddle where everyone else gets a spinner and a joke.

The all-cancelled line is ordinary text, not a live region, for a related reason: the toast has already announced the cancel that caused it. Announcing a second line on top would talk over it.

## No joke while a change is on its way

The badge gets a quip while offline or unable to sync, and none when changes are just waiting a moment.

Why: online, a waiting change is gone in about a second. A line that appears and vanishes that fast is a flash, and the same line eighty times a day stops being funny.

What lost:
- **A quip in every badge state.** More places for the voice, and most of them unreadable.

## One pool for "offline" and "can't sync"

The `badge` lines fit both states: "working from memory", "saved here meanwhile".

Why: both mean the same thing to you: the app is carrying on without the server. Lines about the Wi-Fi would be wrong when the Wi-Fi is fine and the server is restarting.

What lost:
- **A pool per state.** Sixteen lines to keep the pill funny in two cases that look the same from the outside.

## The form passes the day down

`sheetActions`, `OccurrenceSheet` and `DeleteSection` each take the day as an argument instead of working it out.

Why: the functions stay pure, so the tests give them a date and check the answer. And the screen works the day out once, from the server's clock, so every quip on it agrees.

What lost:
- **Each piece reads the clock itself.** Fewer arguments, but each piece could land on a different side of the boundary, and the tests would need a fake clock.

## An empty day gets the notice too

In day view, one empty day now shows "No classes today" with a quip. Before, the notice showed only for an empty week.

Why: the ticket's moment is "empty day", and on a phone the app shows one day. With the old rule, the line would almost never appear where the app is mostly used.

What lost:
- **Leave the rule alone.** The smallest change, and the empty-day quip would show only in a week with nothing in it.

This is the one place the ticket changed behaviour beyond adding words, so the PR says so. The rule lives in the screen and has no test of its own yet (later list).

## Check yourself

- Why do the lines take turns instead of being picked at random each day?
- A user sets their day to start at 04:00. At 02:30, which day's quip do they see, and why is that the right one?
- Which toast has no quip, and what would be wrong with giving it one?
- Why does the roast count the class's own day and not today?
- What does a screen reader say while the week loads, and why not the joke?
