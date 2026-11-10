# Offline cancel choices

The choices made while building ticket #9, cancels that work offline. The plan was settled before any code, in [[Cancel and group choices]] ("Offline cancels: the last change wins"). These are the places where building it filled a gap in that plan or moved away from it. PR #18 lists each one under "Where this differs from the ticket", and the one that changed the plan's text, one tab at a time, is a bullet of **ADR v0.3** in `JOURNEY.md`. `CONTEXT.md` names the thing all of them are about: a **waiting change**. How the code does it: [[Offline cancels]]. The machinery underneath: [[Mutations and offline queues]].

## Draw queued changes on top; the cache holds only the server's word

The ticket said queued changes update the cached weeks. They don't. The cache only ever holds what the server said, and the screen draws the cached weeks with every queued change applied on top (`withQueuedChanges`).

Why: the cache is also where every refetch lands. Offline at 9:00, you skip Data Structures. At 9:05 the signal flickers back long enough to refetch the week, but your change is still waiting behind a retry. Had the skip been written into the cache, that refetch would replace it with the server's "on": the stripes vanish, and come back only when the change finally lands, or never, if it's dropped. Drawn on top, the refetch updates the cache, the skip is applied again at the next draw, and nothing flickers. A change the server refuses needs no rollback code either: it leaves the queue, so it stops being applied, and the screen shows what the server has.

What lost:
- Writing the guess into the cache in `onMutate`, TanStack's classic optimistic update. A refetch can wipe it, the rollback has to remember the old value, and the saved copy of the reads would hold guesses beside the server's answers with nothing to tell them apart.
- Showing nothing until the server confirms. Already rejected in [[Cancel and group choices]]: an offline cancel would look like a missed tap, and you'd tap again.

The cost: everything that shows an occurrence must go through `withQueuedChanges`. Today that's the calendar, and the sheet it opens.

## A 401 retries; it doesn't pause the queue

The plan said a `401` "waits until you sign in again". It does wait, but by retrying with the usual backoff, up to 30 s apart, not by pausing. The `401` also makes the queue fetch the weeks again, so the calendar meets the `401` itself and goes to sign in. Signing in reloads the app, which sends the queue.

Why: a pause needs something to end it. TanStack's queue pauses only for "offline" and wakes only on the browser's `online` event. Pausing on a `401` would mean a third state beside online and offline, plus code to leave it when you sign in again. Retrying needs nothing new: the change keeps trying, and the first try after you've signed in goes through. The cost is one small request every 30 s, from an open tab, while you're signed out.

The refetch is there because a change isn't a read. The calendar sends you to sign in only when one of its own reads fails with `401`; without the refetch, the queue would retry quietly while the screen looked signed in.

What lost:
- Pausing the queue on a `401` and resuming it after sign-in: a new state in TanStack's network logic, for the same result.
- Dropping the change on a `401` like any other 4xx: an expired session would silently lose every cancel made offline, which is exactly the moment the queue exists for.

## Drop what can never work

A change is dropped for any 4xx except `401`, `408` and `429`, and for any error from the app itself. A `404` gets its own message, "it's no longer on the calendar". A "success" that isn't JSON (campus Wi-Fi's login page answering instead of our API) is retried.

Why: all changes share one scope, so they go one at a time. A change at the front that can never succeed would block every change behind it, forever. A `422` will be a `422` next time too, and a bug in our own code fails the same way on every try. A `408` (the request timed out on its way) and a `429` (too many requests) are the server saying "later", not "no".

What lost:
- Retrying everything: one bad change, or one bug, and the queue never moves again.
- Retrying only network errors: a `503` during a server restart would lose every change sent in those seconds.

## One tab at a time

Spec #6's edge case 7 said two tabs need no lock or leader election: both may send the same queue, and since the request is idempotent, a change sent twice does no harm. That's true about *sending*. It missed *saving*. Each tab saves its own whole copy of the queue under one IndexedDB key, so the tab that saves last wins: a cancel made offline in one tab is erased by the other tab's next save, and gone for good once the first tab closes. So the app now runs in one tab at a time. It was your call while #9 was built, recorded in ADR v0.3 on 2026-11-09.

A Web Lock marks the running tab, and a second tab asks "Use it here?" ([[Web Locks and BroadcastChannel]]). Yes makes the running tab save both copies at once and step aside. A tab frozen in the background gets 5 seconds to answer before the lock is taken from it.

What lost:
- No lock, as edge case 7 had it: offline cancels can vanish.
- One shared queue that each tab reads, merges and writes back. Two tabs can still read and merge at the same moment, so it needs a lock anyway, and TanStack's persister saves whole copies, so it would also mean writing our own persister.
- Every tab running, with one leader that saves and sends. A change made in another tab must travel to the leader first, and it's lost if the leader dies before it arrives. Much more code, for an app usually open in one tab.
- Asking you to close the other tab yourself. On a phone you may not find it, and a frozen one can't answer.

The cost: startup now waits on a lock, so a bug there would leave a tab on "Tasks is open in another tab". Browsers without Web Locks or BroadcastChannel (older than 2022) skip the lock and just run.

## The mark after 2 seconds, not only while paused

A block shows the clock while its change is paused, after a try has failed, or once its first try has taken 2 seconds.

Why not "only while paused": paused means the browser said offline. On one bar of signal in a basement lab, or on campus Wi-Fi before its login page, the browser says online, the request hangs for a minute, and nothing is paused and nothing has failed. The change would look done when it isn't. Why not "for every unconfirmed change": with good signal the answer comes back in a few hundred milliseconds, so the mark would flash on every tap and teach you to ignore it. Two seconds is longer than a good answer takes and shorter than you'd wait before wondering.

What lost:
- The mark only while paused: it misses a request hanging on a weak signal.
- The mark on every unconfirmed change: it flashes on every tap.
- A spinner: it says "busy". The mark has to say "saved on this phone, not yet on the server", which is what the sheet spells out.

## Signing out offline needs the server

The button works offline and still warns about waiting changes, but it can't sign you out. It says "You're offline. Signing out needs the server, so nothing was deleted."

Why: the session lives on the server, as a row. The phone holds only its id, in a cookie marked `HttpOnly`, which the page's own scripts can't read or delete ([[Cookies and sessions]]). Signing out means asking the server to delete that row and tell the browser to drop the cookie. If the app forgot only its own data offline and showed the login screen, the phone would look signed out while still carrying a working session cookie. Whoever brings the phone back online opens the app and is signed in as you, with every class fetched again. Deleting nothing and saying why matches what's actually true.

What lost:
- Forgetting the phone's data offline and calling that signed out: the case above.
- Queuing the sign-out to send later: until the signal returns, the cookie still works, so it's the same hole with a delay.
- The old message, "Couldn't sign out. Try again.", which didn't say why, or that trying again offline can't help.

## The queue gets its own key and format

The saved reads live under `tasks-query-cache` and are dropped whenever `CACHE_BUSTER` changes. The queue lives under its own key, `tasks-queued-changes`, with its own version string, `QUEUE_FORMAT = 'v1'`, and no age limit.

Why: a buster bump is cheap for reads. Their saved copy is thrown away, and the next open with signal fetches it again. For the queue it would throw away changes the server never got (spec #6, edge case 8). And a bump isn't rare: v0.3 already made one, when groups lost their first day. So `QUEUE_FORMAT` is never changed to start clean. If a queued change's shape ever has to change, the old ones are converted as they're read back.

What lost:
- One saved copy for both, under `CACHE_BUSTER`: the next shape change would wipe the waiting cancels on every phone that had any.
- One saved copy, with a buster that skips the queue: TanStack's buster applies to a whole saved copy, so it can't skip part of one.

The cost is a one-way door. `tasks-queued-changes` with `'v1'` is now data sitting on phones, so any later change to how a queued change is stored must still read `'v1'`, or carry it across.

## Check yourself

- At 9:05 a refetch lands while your skip from 9:00 still waits. What does the calendar show under each design, the cache written or the queue drawn on top?
- Why does a `401` need the queue to fetch the weeks again, when a `5xx` doesn't?
- Edge case 7 was right that sending a change twice is harmless. What did it miss? Trace the lost cancel with two tabs and one IndexedDB key.
- You're in a basement lab on one bar of signal and tap Prof. When does the clock appear, and why not at once?
- You sign out offline on a friend's phone. Why does the app refuse to forget your data, and what would happen if it didn't?
- A new version renames a field in `Me` and bumps `CACHE_BUSTER`. What happens to the saved reads, and to a change you queued yesterday?
