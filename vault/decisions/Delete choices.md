# Delete choices

The choices made while building ticket #14, Delete. The spec (#6, user stories 45 to 49, edge case 5) set the shape: Delete always offers "Archive instead", asks for the name when it would lose history, and is a plain confirm otherwise. Everything below filled the gaps; the first-draft gaps found in code review are marked. PR #25 lists them. How the code does it: [[Delete with the typed name]]. The read it extends: [[Archive choices]].

## The server says whether there is history

`hasHistory` is a field on the impact read the form already uses.

Why: the phone holds only the weeks it has loaded, and a cancel or a class can be months away. Only the server sees every date, and it already loads every override for the count in #12. It also knows the user's today from their profile, so a wrong phone clock can't change the answer.

What lost:
- **The form works it out from what it has loaded.** Wrong whenever the history is outside the loaded weeks, and wrong in the unsafe direction: "no history" when there is some.
- **A separate `/history` route.** One more route for a number the same query already walks.

## Two things count: an override, or a day before today

Why: both are things deleting would lose. An override is something you did on purpose. A past day is attendance and a past on the calendar. A class that starts today has neither, so it gets the plain confirm, like Archive refusing it.

What lost:
- **Only overrides.** A class that ran all semester with no cancels would delete with a plain confirm: the exact slip the spec is about.
- **"Anything at all", including today.** A class created a minute ago would ask for its name before you could undo a typo.

## Yesterday, not today

The history check stops at yesterday, the same day Archive sets.

Why: one rule, said once. The day you delete in is the day you are choosing the answer in, and Archive already decided that day doesn't count ([[Archive choices]]). The shared `dayBefore` keeps the two from drifting.

What lost:
- **Today counts as past.** A class starting today would ask for its name, and "Archive instead" wouldn't be offered for it: two answers to one question.

## A forgiving name check

Letters and digits only, any script, lowercase, with spaces, symbols and marks dropped on both sides.

Why: it is a speed bump to stop two quick taps, not a password. On a phone, people mistype capitals and drop the middle dot in "Classes · Sem 3". Letters and digits in any script keeps Hindi, Arabic and Chinese names working, where `[a-z0-9]` would turn them into nothing.

What lost:
- **Exact match.** Annoying to type on a phone, and the wrong kind of friction.
- **Ignore case only.** "classes sem 3" wouldn't work, and that is the example the spec gave.
- **ASCII letters and digits.** Empty for most non-English names, so any input would match: no protection at all.

## An emoji-only name must be typed exactly

When the name has no letters or digits, the typed text has to equal the trimmed name, so an empty box never matches.

Why: the forgiving rule turns such a name into the empty string, and an empty box would be "the same". The spec's edge case 5 asks for exactly this.

What lost:
- **Skip the name for these.** A group named 🎓 with a year of history would delete with a plain confirm.
- **Always require typing "DELETE".** One more word to know, and unrelated to the thing being deleted.

## Marks are dropped too (the spec's wording)

The combining marks in Hindi, Thai and Arabic vowels aren't letters or digits, so they are dropped on both sides, and so are an emoji's invisible modifiers.

Why: the spec says "letters and digits". Keeping marks would have stopped the emoji rule above working: an emoji's variation selector is a mark, and an invisible one at that. Dropping them only makes the check more forgiving, never stricter. Review noted it, and a test documents it.

What lost:
- **Keep marks.** More exact for Hindi, and a typed emoji would fail without its invisible half.

## When the answer isn't there yet, ask for the name

While the read is on its way, or after it failed, the form treats it as "has history".

Why: the safe default. Asking for the name when it wasn't needed costs a few taps; skipping it when it was needed costs a semester.

What lost:
- **A plain confirm until the answer arrives.** A fast thumb could delete history before the read answered.
- **Disable Delete until it arrives.** Offline, the answer never comes, and Delete would stay off for good.

## One section for both forms

`DeleteSection` is shared, and the series form's own two-step was removed. The group form gained Delete at the same time.

Why: the spec asked for one behaviour, and review for #12 had already flagged two forms with near-copies of the Archive wiring. Sharing the section means the name rule, the focus handling and the Enter handling live once.

What lost:
- **Leave the series form as is and add one for groups.** Two rules for the same question, drifting at the first change.

## Found in review

Enter in the name box deleted while a Japanese or Chinese input method was still picking a word; it now checks `isComposing`. The focus was lost after Keep it, and when the name box disappeared because the answer arrived late; both now move it back to a sensible control.

## Not done here

On the later list from code review: telling a screen reader when the typed name matches (#50 on the local list), and `hasHistory` being stale for a cancel that is still in the offline queue (#51). Left alone: "Archive instead" saves the whole form, like the Archive button; and the 13 older count assertions in `archive.test.ts` became partial matches (`toMatchObject`), so they no longer pin the full answer shape.

## Check yourself

- Why does the server decide `hasHistory` instead of the form?
- A class started last week and has no override. Plain confirm or name? And one that starts today?
- Why does a group named 🎓 need a different rule from "Classes · Sem 3"?
- What would go wrong if `hasHistory` being unknown meant "no history"?
- Why was "keep marks" rejected, even though it is stricter?
