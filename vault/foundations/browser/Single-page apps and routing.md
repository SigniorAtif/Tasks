# Single-page apps and routing

> **Builds on:** [[HTTP basics]]

## Two ways to build a website

**Multi-page (the classic way).** Every click asks the server for a new HTML page. Tap "Timetable" on the KIIT portal, the screen goes white, and the server sends a whole new page. The server decides what each URL shows.

**Single-page app (SPA, what we build).** The server sends one mostly empty HTML page (`index.html`, just `<div id="root">`) and a JavaScript bundle, **once**. From then on, JavaScript in the browser draws every screen and only fetches *data* (JSON) from the API. Tapping a link swaps what's on screen without loading a new page. Why we chose this: [[Why no Next.js]].

## So who decides what `/login` shows?

In an SPA, a **router** in the browser does. It's a piece of JavaScript that:

1. reads the address bar (`/login`),
2. picks the matching screen (the `LoginScreen` component),
3. on a link click, changes the address bar with the History API (`history.pushState`) **without** asking the server for a page, and draws the new screen.

The back button still works, because the router listens for it and draws the previous screen.

## The catch: reloading `/login`

If you type `https://tasks.ahmedatif.in/login` and press Enter, the browser *does* ask the server for `/login`. There is no file called `login`. So the server (the API, which serves the built app in production) must answer every app URL with the same `index.html`, and then the router in the browser reads `/login` and draws the right screen. This is called the **SPA fallback**. The service worker does the same offline: any navigation gets the cached `index.html` ([[PWAs and service workers]]). The exception is the server's own URLs, `/api/...` and `/healthz`, which must reach the server.

## Routing in our app: TanStack Router

**File-based routes.** One file per URL in `apps/web/src/routes/`:

| File | URL |
|---|---|
| `__root.tsx` | Wraps every screen (the layout) |
| `index.tsx` | `/` |
| `login.tsx` | `/login` |
| `series.new.tsx` | `/series/new` |
| `series.$seriesId.tsx` | `/series/<id>` (`$seriesId` marks a part of the URL that is a value) |

A build plugin reads that folder and writes `src/routeTree.gen.ts`, the list TypeScript uses to check links. Write `<Link to="/logn">` and `pnpm typecheck` fails, because no such route exists.

**`beforeLoad`: code that runs before a screen draws.** This is how you stop a screen from flashing. The `/` route's `beforeLoad` fetches `/api/v1/me`; on a 401 it throws `redirect({ to: '/login' })`, and the router goes to `/login` without ever drawing the home screen. Without it, you'd draw the home screen empty, notice there's no user, then jump to the login: a visible flash, and a moment where the screen shows nonsense.

In our app, the `/` route and the check it runs:

*From `apps/web/src/routes/index.tsx` and `apps/web/src/lib/require-session.ts` (shortened):*
```tsx
// apps/web/src/routes/index.tsx
export const Route = createFileRoute('/')({
  // …
  beforeLoad: ({ context }) => requireSession(context.queryClient),
  component: HomeScreen,
});

// apps/web/src/lib/require-session.ts
  try {
    await queryClient.ensureQueryData(meQuery);
  } catch (error) {
    if (isUnauthenticated(error)) throw redirect({ to: '/login' });
    throw error;
  }
```

What to notice:
- `createFileRoute('/')` names the URL this file answers; the router plugin keeps that string in step with the file name.
- `beforeLoad` runs first, `component` only if it finishes without throwing.
- `throw redirect(...)` is how a `beforeLoad` says "go there instead". Since v0.2, `ensureQueryData` answers from the cache when it already holds `/api/v1/me` (restored from the phone, say), and only fetches when it doesn't.

**Search params, validated.** `/login?error=not_invited` has a *search param* (the part after `?`). The login route's `validateSearch` reads it and drops anything else, so the component gets a typed `{ error?: string }` instead of raw text.

*From `apps/web/src/routes/login.tsx` (shortened):*
```tsx
interface LoginSearch {
  error?: string;
}

export const Route = createFileRoute('/login')({
  // …
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    error: typeof search.error === 'string' && search.error !== '' ? search.error : undefined,
  }),
```

The router hands `validateSearch` whatever was after the `?`, typed `Record<string, unknown>` ("any keys, values not yet known"). It returns only `error`, and only when it's a non-empty string, so an empty `?error=` or an extra `&x=2` never reaches the screen.

**Pending and error screens.** While `beforeLoad` waits, the router shows `PendingScreen` (a spinner, only if it takes more than a second, so fast loads don't flicker). If it throws something other than a redirect, it shows `ErrorScreen` with "Try again".

## Check yourself
- You're on `/` and tap a link to `/login`. Does the browser download `index.html` again? What about when you press reload on `/login`?
- Why must the server's SPA fallback skip `/api/...`? What would happen to Google's redirect to `/api/auth/callback/google` if it didn't?
- Predict: you move the 401 check from `beforeLoad` into the home screen's component (`if (error) navigate('/login')`). What does a signed-out user see for a split second?
