# Server state and caching

> **Builds on:** [[HTTP basics]] · [[Single-page apps and routing]]

## Two kinds of state

**State** is any data a screen depends on that can change. It comes in two very different kinds:

- **UI state** belongs to the browser and nobody else: "is the menu open", "which tab is selected", "is the sign-in button busy". Only this screen knows it, and it's always correct. React's `useState` is enough.
- **Server state** lives on the server, and the browser only has a **copy**: "who am I", "what are this week's classes". The copy can be **stale** (out of date). If you cancel a class on your laptop, the copy on your phone stays wrong until it asks again. It can also be *loading* or *failed*.

Handling server state well means answering five questions for every piece of it. When do we fetch it? Where do we keep the copy? When do we fetch it again? What do we show while it loads or fails? When do we throw it away? TanStack Query answers them once, for the whole app.

## TanStack Query in our app

**One cache, keyed by name.** Each piece of server state has a **query key**, a list that names it: `['me']`, `['healthz']`. Ask for the same key twice and you get the same cache entry, even from two places. Our `/` route's `beforeLoad` and its screen both use `meQuery`, so the screen finds the answer already there and draws instantly.

**Query options in one place.** `src/lib/queries.ts` defines each read once: its key, the function that fetches it, and how often to refresh. For example:

*From `apps/web/src/lib/queries.ts`:*
```ts
export const meQuery = queryOptions({
  queryKey: ['me'],
  queryFn: ({ signal }) => apiGet<Me>(paths.me, { signal }),
  // While the screen is open (and the app in front), ask again every minute:
  // it re-syncs the server clock and notices a session that has ended.
  refetchInterval: 60_000,
});
```

What to notice:
- `queryKey` is the name of the cache entry, and anyone using `meQuery` shares it.
- `queryFn` is how to fetch it. TanStack Query passes in a `signal`, which cancels the request if nobody needs the answer any more.
- `queryOptions(...)` only bundles the settings. Nothing is fetched until a route or a component asks with it.

**Refetching.** A cached answer is shown immediately, then fetched again in the background:
- every 60 s while the screen is open and the app is in front (`refetchInterval`);
- when you switch back to the app (`refetchOnWindowFocus`, on by default). That's how the deployed commit (in the account menu since v0.2) notices a new deploy.

**Retries.** A failed request is tried again, but only when that could help: a network blip or a 5xx, twice. A 4xx means "your request is the problem" (401: no session), and asking again gets the same answer, so it isn't retried.

*From `apps/web/src/lib/query-client.ts`:*
```ts
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status < 500) return false;
  if (error instanceof NetworkError && !onlineManager.isOnline()) return false;
  return failureCount < 2;
}
```

TanStack Query calls this after each failure, with how many tries have failed so far. The first `if` is the 4xx rule, and `failureCount < 2` allows two retries. The second `if` arrived with v0.2's offline support: once the browser has said it's offline, retrying a network failure is pointless ([[Offline reads]]).

**Failures with old data.** If a refetch fails but there's an older answer, the screen keeps showing it with a warning banner instead of going blank. The calendar's "now" line keeps moving from the last answer's server time.

**Throwing it away.** On sign-out, `queryClient.clear()` empties the cache, so nothing of yours is left for the next person to see. Since v0.2 the cache is also saved to the phone's storage (IndexedDB) for offline use, so sign-out deletes that copy too (`forgetCachedData`, [[Offline reads]]).

## Why only one cache (D-046)

The service worker could also cache API answers. We don't let it. Two caches of the same data drift apart: the service worker shows last Tuesday's week while TanStack Query has today's, and you get bugs nobody can explain ("why does the cancel I undid come back?"). One cache, owned by one library, is something you can reason about. The service worker caches only the app's own files ([[PWAs and service workers]]).

## Alternatives

- **`fetch` inside `useEffect`:** fine for one screen. Then you rebuild caching, refetching, retries, and the race where an old answer arrives after a new one, one bug report at a time.
- **SWR:** the same idea, smaller, with fewer features (no queue for offline writes, which v0.3 needs).
- **Putting API data in a global store (Redux, Zustand):** you'd write the loading, error and staleness logic yourself. Those tools are for UI state.

## Check yourself
- Is "the sign-out button is spinning" server state or UI state? What about "your profile's time zone"?
- Trace: the home screen is open, and you switch to WhatsApp for five minutes, then back. Which requests fire, and why?
- Why is a 401 not retried, while a 503 is? Give a case where retrying a 503 helps.
- Predict: you remove `queryClient.clear()` from sign-out, then the login screen's `beforeLoad` runs. Where does it send you, and why? (Hint: what is still in the cache under `['me']`?) What extra risk appears in v0.2, when the cache is saved to the phone?
