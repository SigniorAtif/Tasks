# Dev server proxy

> **Builds on:** [[HTTP basics]] · [[Origin]]

## The problem

In development two programs run on your laptop:

- **Vite**, the dev server, at `http://localhost:5173`. It serves the web app.
- **The API** at `http://127.0.0.1:3000`. It answers `/api/...` and `/healthz`.

Different ports mean different **origins** ([[Origin]]). If the page at `localhost:5173` called `localhost:3000` directly, the browser would treat it as a cross-origin request: the API would need **CORS** headers (a list of which other origins may read its answers, and whether they may send cookies), every `fetch` would need `credentials: 'include'` to send the login cookie, and Better Auth's origin checks would see two different origins. Production has none of this: one server serves both the app and the API on `https://tasks.ahmedatif.in`, so development should look the same.

## The fix: let Vite forward

A **proxy** is a program that receives a request and passes it on to another server, then passes the answer back. Vite has one built in. In `apps/web/vite.config.ts`:

*From `apps/web/vite.config.ts` (shortened):*
```ts
const apiTarget = process.env.API_PROXY_TARGET || 'http://127.0.0.1:3000';
// …
const proxy = {
  '/api': { target: apiTarget, changeOrigin: false },
  '/healthz': { target: apiTarget, changeOrigin: false },
};
```

Each key is a path prefix: any request whose path starts with `/api` or `/healthz` is forwarded to `apiTarget`; everything else (the page, the JavaScript) Vite serves itself. `||` rather than `??`, so an empty value (`API_PROXY_TARGET=`) counts as unset instead of forwarding to nowhere.

Now the browser only ever talks to `localhost:5173`:

```
browser ──GET /api/v1/me──▶ Vite (5173) ──forwards──▶ API (3000)
browser ◀──── JSON ─────── Vite (5173) ◀── JSON ───── API (3000)
```

To the browser it's all one origin, exactly like production: the cookie is first-party, there's no CORS, and the web app's code calls plain paths (`/api/v1/me`, no host) that work unchanged in both places.

## `changeOrigin: false`: keep the Host header

Every request carries a **`Host` header** naming the site the browser thinks it's talking to (`Host: localhost:5173`). A proxy can rewrite it to the target's (`127.0.0.1:3000`); that's what `changeOrigin: true` does. We keep it **false**, so the API sees `localhost:5173`, the same origin as `BETTER_AUTH_URL`. Better Auth builds redirect URLs and checks request origins from that; with the wrong host, sign-in would redirect to the wrong place or be rejected.

You can see it working: the throwaway mock API used to check the web app logged `host=localhost:5173` on every forwarded request.

## When the API isn't running

Vite can't forward, so it answers **502 Bad Gateway** itself, with no JSON body. The web app's api helper turns a bare 502/503/504 into "The server is not answering. It may be restarting." In production, Caddy does the same thing when the API container is down.

## Pointing it elsewhere

`API_PROXY_TARGET` changes where Vite forwards, without touching the code: `API_PROXY_TARGET=http://127.0.0.1:3100 pnpm --filter @tasks/web dev` sends API calls to a mock on port 3100. `vite preview` (the production build) forwards the same way.

*From `apps/web/vite.config.ts`:*
```ts
  server: {
    port: 5173,
    // Fail loudly if 5173 is taken instead of quietly moving to 5174: the
    // API's BETTER_AUTH_URL and the Google redirect URI both name 5173.
    strictPort: true,
    proxy,
  },
  // `vite preview` serves the production build; it needs the same forwarding.
  preview: { proxy },
```

The one `proxy` object is used twice, for `pnpm dev` (`server`) and for `vite preview`. `strictPort` matters for the same reason as `changeOrigin`: sign-in only works on the origin Better Auth and Google were told about.

## Alternatives

- **Enable CORS on the API** and call `localhost:3000` from the page: more config, cookie trouble, and development no longer matches production.
- **Put Caddy in front in development too:** exactly like production, but one more program to run for every change.

## Check yourself
- You open `http://localhost:5173/healthz` in the browser. Which program receives the request first, and which one writes the JSON?
- Predict: you set `changeOrigin: true`. Which header changes, and which part of sign-in is likely to break?
- Why does the web app's code never contain `localhost:3000` anywhere?
