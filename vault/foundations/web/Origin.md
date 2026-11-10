# Origin

> **Builds on:** [[HTTP basics]]

An **origin** is three things together, *scheme + host + port*: `https://tasks.ahmedatif.in:443`. Browsers use it as the security boundary between websites.

- **Scheme** is the protocol: `http` or `https`. (Not the product.)
- **Host** is the domain name: `tasks.ahmedatif.in`.
- **Port** is the numbered door on the machine: 443 for HTTPS by default, 80 for HTTP. The URL usually hides it, because it's the default.

Our server needs to know its own origin, since sign-in redirects and the CSRF checks below both use it. So `BETTER_AUTH_URL` must be exactly an origin, and the start-up check uses the URL parser to make sure:

*From `apps/api/src/env.ts`:*
```ts
/** An origin is scheme + host + port and nothing else, e.g. `https://tasks.ahmedatif.in`. */
const origin = z
  .url({ protocol: /^https?$/, error: 'must be an http(s) URL' })
  .refine((value) => new URL(value).origin === value.replace(/\/$/, ''), {
    error: 'must be an origin like https://tasks.ahmedatif.in, with no path',
  })
  .transform((value) => new URL(value).origin);
```

What to notice:
- `new URL(value).origin` is the built-in way to get an origin: `new URL('https://tasks.ahmedatif.in/login').origin` is `'https://tasks.ahmedatif.in'`. The default port 443 is left out, just as in the address bar.
- The `.refine` rule says "the value must already *be* its own origin" (one trailing `/` forgiven). So `https://tasks.ahmedatif.in/app` is refused at start-up, instead of breaking sign-in later.
- `z.url(...)`, `.refine(...)` and `.transform(...)` are zod: check it's a URL, check one extra rule, then hand on a cleaned-up value.

## Same parts, two different jobs

The server and the browser both look at host and port, for different reasons.

The server uses them to *route*. DNS turns the host into an IP address (which machine), and the port picks which program on that machine answers: Caddy listens on 443. Caddy then reads the **`Host` header**, which the browser sends with every request (`Host: tasks.ahmedatif.in`), to pick which site to serve. That's how one VPS serves `tasks.ahmedatif.in` and `photos.ahmedatif.in` from the same IP and port. The name for it is "virtual hosting".

The browser uses them to *isolate*. Your browser runs code from many sites at once, in tabs and iframes, and the origin is its rule for which data each piece of code may touch. Code from `evil.com` must not read your `tasks.ahmedatif.in` cookies or offline data, or read the response of a request it makes to our API.

Why can't the server do the browser's job? If `evil.com`'s JavaScript makes your browser send a request to our API, that request really does come from your browser, with your cookies attached. To the server it looks exactly like you. Only the browser knows which page's code started it, so the browser enforces the boundary. (The server still adds its own defences, such as SameSite cookies and CSRF checks; the auth notes cover them.)

## What the browser ties to an origin

- **Cookies**, which keep you logged in.
- **Storage:** `localStorage`, IndexedDB (where our offline cache lives), and the service worker (what makes the PWA work offline).
- **Push subscriptions**, the permission to send you notifications.
- **The installed PWA itself.**

Change the origin and the new one starts with none of it: you log in again, reinstall the app, and re-allow notifications. That's why the address gets chosen once and then left alone.

## Same-origin vs cross-origin

- `https://tasks.ahmedatif.in/api/v1/...` called from `https://tasks.ahmedatif.in/` is **same origin**. The browser sends cookies, and no extra rules apply.
- `https://api.ahmedatif.in/...` called from `https://tasks.ahmedatif.in/` is **cross-origin**. The browser blocks reading the response unless the API answers with **CORS** headers that allow it, and cookie handling gets stricter.

Look closely at what's blocked: *reading the response*, not sending the request. A cross-origin page can still *send* requests (a form submit, a `fetch`, an `<img>` tag). So a request arriving is never, on its own, proof that it's legitimate.

We serve the web app and the API on one origin and skip that whole layer.

## Same-origin vs same-site (the sibling-subdomain trap)

These are two different browser rules:

- **Same-origin:** scheme, host and port all match *exactly*. `tasks.ahmedatif.in` and `photos.ahmedatif.in` are **different origins**, because the hosts differ.
- **Same-site:** same scheme and same *registrable domain* (`ahmedatif.in`). `tasks.` and `photos.` are the **same site**.

Here's why the difference matters. The `SameSite=Lax` cookie setting only stops cookies on **cross-site** requests. A request from `photos.ahmedatif.in` to `tasks.ahmedatif.in` is *same-site*, so the browser **does** attach your tasks login cookie. If `photos` ever had a bug that let an attacker run JavaScript on it (XSS), that code could make your browser send writes to the tasks API, as you. Your own other app becomes the way in.

Our defences, built in the auth module:
1. The tasks API checks the **`Origin` header** on writes and rejects anything not from `https://tasks.ahmedatif.in`. Better Auth does this on its own sign-in routes, and Hono's `csrf()` does it on form-style writes to `/api/v1/*`; together they're the CSRF guard. A JSON write from another origin, `photos.` included, never even gets that far: the browser first asks permission with a CORS "preflight", and we never say yes.

   ```ts
   // apps/api/src/app.ts
     app.use(`${paths.apiV1}/*`, csrf({ origin: env.BETTER_AUTH_URL }));
   // apps/api/src/auth/auth.ts
       // Requests that change state must come from this exact origin, no wildcards.
       trustedOrigins: [env.BETTER_AUTH_URL],
   ```

   Both name one exact origin, `BETTER_AUTH_URL`, the value the `origin` rule above checks. "Exact" is the whole point: `https://photos.ahmedatif.in` is a different origin, so it fails both checks even though it's the same *site*.

2. The login cookie is **host-only** (it has no `Domain` attribute), so it's never sent to, or readable by, `photos.` or any other subdomain. (An earlier version of this note said it would use the `__Host-` name prefix. Better Auth actually uses `__Secure-`; the effect here is the same, and [[Auth]] explains the difference.) See [[How a request travels]] and [[First-commit decisions]].

## Check yourself
- Are `http://tasks.ahmedatif.in` and `https://tasks.ahmedatif.in` the same origin?
- Are `tasks.ahmedatif.in` and `photos.ahmedatif.in` the same origin? The same site? (Answered above. Can you explain why the second answer is the dangerous one?)
- If `evil.com` sends a `POST` to our API, what stops it: the browser, `SameSite`, or our `Origin` check?
