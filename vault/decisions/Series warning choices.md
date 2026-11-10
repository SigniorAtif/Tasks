# Series warning choices

The choices made while building ticket #13, the series form's warnings. The spec (#6, edge cases 2 and 3) set the shape: a later first day and a new timing warn before Save, with a count from the server like #12's last day, and saving keeps what it hides. Everything below filled the gaps; two of the choices came from code review. PR #24 lists them. How the code does it: [[Series change warnings]]. The read it extends: [[Archive choices]].

## One request for the whole edit

The form sends one question with everything Save would change, `?firstDay=…&lastDay=…&byDay=…&interval=…`, and gets three counts back.

Why: edits combine. Move the first day to 1 Oct *and* drop Wednesdays, and a Wednesday cancel on 9 Sep is hidden twice over. Asked separately, each question would count it, and the form would warn about two changes that are really one. One question to `stopShowing` sees the edit as it will be saved, combinations included.

What lost:
- **One request per field.** Simpler to write, one more round trip per field, and double counts whenever two edits overlap.
- **A flag on the `PATCH`** ("tell me, don't save"). A save and a question would share one route, and a missing flag would save by accident.

## Each change counted once, by its date

A hidden change goes to exactly one count: before the new first day, else after the new last day, else off the timing.

Why: the sentences sit under different fields, and someone reading all three should be able to add them up. A change's date says best which edit hid it: a cancel before the first day is gone because of the first day, whatever else changed.

What lost:
- **Counting by every reason.** "Why" becomes a list per change, and the sums stop meaning anything.
- **Asking the engine once per edit** to see which one hides what. Three times the work, and still ambiguous when two edits hide the same change.

## Days and interval travel together

`?byDay=` without `?interval=` (or the other way round) is a 422.

Why: a timing is both halves, and the form's `changedFields` already sends the whole rule when either changes. Accepting half would mean filling in the other half from the saved rule on the server, a guess the form never needs. The checks reuse the weekly rule's own field schemas, so the read refuses exactly what a save would.

What lost:
- **Either half alone, the other from the saved rule.** Shorter URLs, and a second way to describe the same edit.

## Ask what Save would send

The question comes from `changedFields`, Save's own diff, through `impactAsk`.

Why: the warning is about *this* save. Using the same diff means the form can't warn about something Save won't do, or miss something it will. A room or title change asks nothing, because it can't hide anything.

What lost:
- **The form's own "what changed" check.** A second answer to the same question, which could disagree with Save.

## The anchor-week case goes under First day

Every 2 weeks counts from the Monday of the first day's week. So a new first day alone, moved by an odd number of weeks, puts the class on the other weeks, and a cancel can stop showing that's neither before the first day nor after the last. The server counts it in `changesOffTiming`. When the timing didn't change, the form words it under First day: "1 change in weeks the class no longer meets will stop showing. The old first day brings it back."

Why: the first build showed `changesOffTiming` only when the timing was asked about, so this case saved silently. The spec review found it. The person changed the first day, so the warning belongs there; under Repeats it would blame a field they never touched.

What lost:
- **A fourth count from the server** (say `changesOffWeeks`). More API for a number the form can already tell apart: it knows whether it asked about a timing.
- **Under Repeats, as it is.** Accurate maths, wrong field.

## One type for the question

`SeriesImpactQuery` is the schema's `z.output`: days as a list, interval a number. The API's `seriesImpact` takes it, and so does the web's `impactQuery`, which turns it into text only when it builds the URL.

Why: the first build wrote the same four fields out by hand in three places: the schema, a web interface with the days as `'MO,FR'` text, and an inline type in the API. The standards review flagged it, along with the URL's text format leaking into the form's type. One type means a new field is one edit.

What lost:
- **Strings in the form's type.** The form had to `join(',')` and `String()` before asking, and the type said less than it could.

## Wait out a half-typed year

The read asks nothing while a date is before the year 1000 (`halfTyped`).

Why: typing 2026 into a date box gives 0002-11-20, then 0020-…, then 0202-… first. Each asked the read and flashed a count for the year 2. That bug came with #12; #13's First day box would have had it too, so it's fixed here, in its own commit.

What lost:
- **Waiting until typing stops** (a debounce: ask only after, say, 300 ms of quiet). Every warning arrives later, and a pause mid-year still asks about 0202.
- **Asking only when the field loses focus.** The warning would come after you've moved on, not while you're deciding.

## The v0.3b note says what ADR v0.3b says

The ticket asked for a comment saying v0.3b *replaces* the timing warning with "Applies from". ADR v0.3b says the opposite: changes on dates the new timing never produces stay hidden, never erased, "with the v0.3 count warning". So the code's note says that from v0.3b a timing applies from a chosen day, and the count covers only the changes from then on. It lives in one place, the doc on `SeriesImpact.changesOffTiming`, and the later list tracks the change.

Why: a comment that contradicts a decision record misleads whoever builds v0.3b. The standards review found it.

## Not done here

From code review, on the later list: a test that an earlier first day brings the hidden changes back; linking the day buttons to the Repeats warning for screen readers (the warning is already read aloud when it appears); renaming the warning helpers, called "note" today, before occurrence notes make that word mean something else; deciding "has the last day changed?" in one place; and an unused `ImpactQuery` type left from #12.

Declined: merging the two three-line impact hooks into one, and checking the read's answer type at runtime. Like every `apiGet<T>`, it trusts the server's JSON.

## Check yourself

- Why one request with everything in it, instead of one per field? Give an edit where the two would disagree.
- A cancel is before the new first day and on a day the new timing drops. Which count gets it, and why only one?
- Why does `?byDay=MO` alone answer 422 instead of using the saved interval?
- A class meets every 2 weeks. You move its first day one week later. Which field warns, and why not Repeats?
- What did the ticket's v0.3b comment get wrong, and where does the corrected note live?
