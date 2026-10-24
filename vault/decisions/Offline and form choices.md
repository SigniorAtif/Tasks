# Offline and form choices

The choices behind v0.2's offline reads and series form (D-042, D-046, D-048, `docs/brainstorm/09-frontend.md` §5.7). How they work: [[Offline reads]] · [[Series form]]. The general ideas: [[IndexedDB and offline storage]] · [[Validating input with schemas]] · [[Idempotency and retries]].

## Keep API data in IndexedDB through TanStack Query, not in the service worker

TanStack Query's persister writes the query cache to IndexedDB and restores it at start-up. The service worker keeps caching only the app's own files, never `/api`.

This is D-046: one cache of API data. TanStack Query already decides when an answer is stale, refetches it, and knows when each answer arrived (`dataUpdatedAt`, which the badge shows). A second copy in the service worker would drift from it: the service worker serving last Tuesday's week while the cache has today's, and an undo that "comes back" after a reload.

What lost:
- *Workbox runtime caching of `/api`* (a `NetworkFirst` rule in the service worker): no app code at all, but two caches of the same data, no "last synced" time the app can read, and sign-out would have to clear a cache inside the service worker too.
- *localStorage*: synchronous (a large write freezes scrolling), text only, about 5 MB. Fine for "dark mode on", not for weeks of occurrences.
- *Dexie, a real client database* (D-047's full replica): queries, live updates, a sync protocol. 12–13 days of work for a multi-device offline problem a single student mostly doesn't have. Deferred, with a trigger.

How it's wired: `@tanstack/query-async-storage-persister` over three `idb-keyval` functions (`get`, `set`, `del`), adapted to the persister's `getItem`/`setItem`/`removeItem` (`toAsyncStorage`), and started by `persistQueryClient`. Why `idb-keyval`? We store exactly one value, the whole cache as one JSON string, and a wrapper of a few hundred bytes is all that needs.

## Restore before the first render, with a 1-second cap

`main.tsx` awaits `restoreQueryCache(queryClient)` before drawing the router. The router's first `beforeLoad` asks the cache "is anyone signed in?", and offline, the saved copy is the only place the answer can come from. If the restore hadn't finished, that check would go to the network and fail.

What lost:
- *`PersistQueryClientProvider`*, the library's React way. It restores in the background and holds queries back until done (`useIsRestoring`). But our router's `beforeLoad` runs outside React's queries and wouldn't wait, so the first `ensureQueryData(meQuery)` would race the restore. Awaiting in `main.tsx` makes the order obvious, in one line.
- *No cap.* A broken IndexedDB (some private modes, a full disk, an old Safari bug where opening it hangs) would leave a blank page forever. With the cap, the app starts empty, as v0.0 did, and a late restore can't overwrite newer answers.

## `networkMode: 'offlineFirst'` for reads, with one more retry rule

A read tries once even when the browser says offline, and further retries wait for the network. A `NetworkError` isn't retried at all once the browser has said it's offline.

With a saved copy on screen, one real try is the cheapest way to learn whether the network is really gone, because the browser can be wrong, both ways. v0.0's comment in `query-client.ts` anticipated the switch.

What lost: `'online'`, the default, never tries while the browser says offline. On KIIT's portal Wi-Fi that's fine, but after a false "offline" it would never even try. `'always'` (v0.0) keeps retrying into a dead network. And without the extra retry rule, `'offlineFirst'` pauses the retry until the network is back, so a screen waiting on it (a loader for a never-opened week) spins forever instead of saying "You're offline".

## `gcTime: Infinity`, and the 30-day limit applied when saving

Queries are never dropped from memory; answers older than 30 days are left out of the saved copy instead.

The persister saves what's in memory. With the default `gcTime` (5 minutes), restored weeks nobody looks at are dropped from memory, then from the saved copy, minutes after the app opens. TanStack Query's docs say `gcTime` must be at least `maxAge`.

What lost: *`gcTime` = 30 days*, the obvious fix, is a trap. Browsers keep a timer's delay in 32 bits, so a `setTimeout` longer than about 24.8 days fires **immediately**, which drops everything at once. *24 days with `maxAge` 24 days* works, but the plan says 30 days, and the number would only be there to dodge a timer limit. The cache is small (a timetable is tens of kilobytes), so keeping it all in memory costs nothing.

## Save each query's last good answer, not only successes

Any watched query holding an answer is saved as a plain success (`lastGoodAnswers`), even if its latest refetch failed.

This was found while checking offline in the browser. A refetch that fails offline marks the query `error` but keeps its answer. TanStack Query's default saves only `success`, so the second offline open lost the user and showed "You're offline".

What lost: *saving error states as they are*, where the restored query would carry a stale error from another moment (and an error object loses its class in JSON, so the badge couldn't tell a network failure from a server error). And *skipping the save while offline*, where a week first opened offline-with-cache could never be saved: more state to get wrong.

## Writes are online-only in v0.2

No write is queued. Save and Delete are greyed out while offline, and a write that fails mid-way shows the error. Mutations use `networkMode: 'always'`, so they fail fast instead of waiting.

This is D-048. The series form can create a group and then a series, and it edits many fields; checking that against a copy that may be days old is where conflicts hide. The first offline write is v0.3's cancel/skip, one small "set target state" change that's safe to replay.

What lost: *a paused-mutation queue now* (D-046's v0.3 design). It needs `setMutationDefaults` for every mutation key so a replayed write still has its request function after a reload, a queue that survives a 401, and an "N changes waiting" chip. Worth it for the phone-at-college moments, not for typing a timetable once.

## "Offline" means the browser said so, or the newest fetch got no answer

The badge and the form's Save button share one signal (`useSyncStatus`): `onlineManager` says offline, **or** the newest fetch of `me` or a calendar window failed with a `NetworkError`.

`navigator.onLine` (which `onlineManager` follows through the `online`/`offline` events) says "online" on Wi-Fi behind a login portal. And TanStack Query's `onlineManager` assumes "online" at start-up, so a cold open in aeroplane mode still looks online to it. The brief named `onlineManager` for the form, but using it alone, the badge would say offline while Save stayed enabled and then failed. One signal keeps them in agreement.

What lost: *seeding `onlineManager` with `navigator.onLine` at start-up*. TanStack Query stopped doing that because `navigator.onLine` can say "offline" wrongly in some setups, and then nothing would ever fetch or save. *Pinging `/healthz` to decide*: an extra request every so often, for something the real requests already tell us.

The cost: when the network comes back without an `online` event (you log in to the portal), Save stays off until the next successful fetch. That's within a minute (`me` refetches every 60 s), or when you switch back to the app.

## Check the form with the API's own schemas

The form builds the request body and runs `createSeriesSchema` / `updateSeriesSchema` / `createGroupSchema` from `@tasks/core` on it before sending, and the server's 422 `errors` go through the same mapping to fields.

That gives both sides one definition of "valid" (D-041). There's no second copy of the rules to drift (the day the API allows 5-weekly classes, the form allows them too), and the messages are the API's.

What lost:
- *Rules written again in the form*: drift.
- *HTML validation attributes only* (`required`, `min`, `max`): no cross-field checks (last day before first), browser-worded bubbles that don't match the server's messages, and different on every browser. The form sets `noValidate` and keeps `min`/`max` only as hints for the number spinner and the date picker.
- *Server only*: every typo costs a round trip, and offline there's no answer at all.

The cost: none extra for the schemas. zod and the Temporal polyfill were already in the bundle, because `@tasks/core`'s index brings in its schemas module. This whole slice (persister, badge, form) grew the JavaScript from 522.7 KB to 558.0 KB (166.5 → 176.3 KB gzipped). It's one file over Vite's 500 KB warning (it was before this slice too), and splitting routes into their own files (`autoCodeSplitting` in `vite.config.ts`) is the fix when it matters.

## Plain controlled inputs, not a form library

One `useState` holds all the values as strings, with `onChange` on each input (React's **controlled inputs**: the input shows what the state says), and pure functions in `form-values.ts` do everything else.

The form has 13 fields, one submit, and validation already done by the schemas. A library would add an API to learn on top of React's, for features this form doesn't need (field arrays, async validation per keystroke, touched/dirty tracking). Pure functions are easy to test in Node, and easy to read.

What lost: *react-hook-form* (uncontrolled inputs registered by ref, fast on huge forms, with a zod resolver) and *TanStack Form* (typed, framework-agnostic, newer). Either becomes worth it when forms multiply (tasks, settings, imports), and the schemas and the `problemsFromErrors` mapping would carry over.

## Smaller calls

| Choice | Why | Alternative |
|---|---|---|
| Ids made once per thing created, kept until saved (`pendingIds`) | A repeated Save after a lost answer re-sends the same id; the server answers 200 with the existing row (D-042) | A new id per tap (duplicates); an `Idempotency-Key` table (not needed until a server-made id exists) |
| Group created before the series, both checked first | The series must point at an existing group; checking both first avoids a half-made pair | One combined endpoint (a new API shape for one form) |
| PATCH only changed fields | Doesn't overwrite another device's change to another field | Send the whole series (last write wins on every field) |
| Delete confirmed in place, no modal | Fewer moving parts, no focus trap to build, a mistaken tap costs nothing | A dialog (`<dialog>` or a library) |
| A 404 on delete counts as done | The class is gone either way; a retry after a lost answer isn't an error | Show "not found" for a delete that worked |
| Subject empty = "same as the title" | One less thing to type for most classes (B8); the server fills it in | Copy the title into the box as you type (then you'd have to clear it to diverge) |
| Swatches use the calendar's `--palette-*` variables | First built with Tailwind's `bg-*-500` classes, because the calendar's variables weren't on this branch yet; switched when the slices were joined, so a swatch is exactly the colour its group's blocks get, in both themes | Tailwind classes (close, but not the same shade as the blocks) |
| Badge time built from `Intl` parts | Newer ICU puts a narrow no-break space before "PM"; tests would differ by machine | `toLocaleTimeString` (output varies by machine and locale) |

## Check yourself

- Why does `gcTime: 30 days` break offline reads, when 24 days wouldn't? What exactly happens to the timer?
- KIIT portal Wi-Fi, app freshly opened: which of `navigator.onLine`, `onlineManager`, and our badge say "offline"? Which one does Save follow, and why that one?
- You add a `room` field to `Series` and rename `location`. What must change in `lib/persist.ts` before shipping, and what would happen on phones if you forgot?
- Name one thing a form library would give this form today, and one thing it would cost.
