# HTTP basics

> **Builds on:** nothing. A starting point.

HTTP is the language the browser and the API speak. Every interaction is one **request** (the client asks) and one **response** (the server answers). Nothing else: no open line between them, no memory of the last request. The path a request takes across the internet is in [[How a request travels]]; this note is about what's *inside* one.

## A real request and response from our API

Run this while `pnpm dev` is up:

```sh
curl -i http://localhost:5173/healthz
```

The request curl sends (simplified):

```
GET /healthz HTTP/1.1          ← method, path, protocol version
Host: localhost:5173            ← headers: one "Name: value" per line
Accept: */*
                                ← empty line; a GET has no body
```

The response:

```
HTTP/1.1 200 OK                         ← status line: the code and its name
content-type: application/json          ← what the body is
cache-control: no-store                 ← don't keep a copy
x-content-type-options: nosniff         ← security headers from secureHeaders()
x-request-id: 92a8f67d-…                ← our id for this request (see [[Structured logging]])

{"sha":"dev","dbOk":true,"time":"2026-10-12T14:35:40.462Z"}   ← the body
```

That's all HTTP is: text-shaped messages with a first line, headers and an optional body. Since HTTP/2 the bytes on the wire are binary and compressed, but the *meaning* is identical, and every tool shows them like this.

On our side, the handler that produced that answer:

*From `apps/api/src/routes/healthz.ts`:*
```ts
  app.get(paths.healthz, async (c) => {
    const dbOk = await pingDatabase(deps.pool);
    const body: Healthz = {
      sha: deps.env.GIT_SHA,
      dbOk,
      // toISOString() is always UTC with a `Z`, as the contract requires.
      time: deps.now().toISOString(),
    };
    // A stale cached "healthy" would defeat the point.
    c.header('Cache-Control', 'no-store');
    // 503 = "temporarily unable": monitors and `docker compose --wait` treat it as unhealthy.
    return c.json(body, dbOk ? 200 : 503);
  });
```

What to notice:
- `app.get(paths.healthz, …)` matches the method (`GET`) and the path (`/healthz`) from the request's first line.
- `c.header(...)` adds the `cache-control` line; `c.json(body, status)` writes the status line, `content-type: application/json` and the body. `x-content-type-options` and `x-request-id` aren't from this handler: middleware adds them to every response ([[Middleware]]).
- The status is a choice: `200` when the database answered, `503` when it didn't, with the same body either way.

## Underneath: IP addresses, TCP and ports

HTTP rides on lower layers you rarely see but constantly use:

- An **IP address** identifies a machine on a network: `127.0.0.1` always means "this same machine" (also called `localhost`). A server on the internet has a public IP; DNS turns names into these.
- **TCP** is the reliable connection two machines open before any HTTP is sent. It guarantees the bytes arrive complete and in order, resending lost ones. HTTP/3 uses a newer transport (QUIC, over UDP) for the same job.
- A **port** is a numbered door on one machine, so many programs can listen at once. One IP, many doors: Vite listens on 5173, the API on 3000, Postgres on 5432, Caddy on 80 (HTTP) and 443 (HTTPS). `localhost:3000` means "this machine, door 3000".
- **Listening on `127.0.0.1` vs `0.0.0.0`:** the first accepts connections only from the same machine; the second from any network the machine is on. That's why the API defaults to `127.0.0.1` on your laptop (your hostel Wi-Fi can't reach it) but uses `0.0.0.0` inside its container (so Caddy, another container, can).
- A **socket** is one open connection: (your IP, your port) ↔ (server IP, server port).

`ss -ltnp` on Linux lists which programs are listening on which ports.

## The URL, piece by piece

`https://tasks.ahmedatif.in/api/v1/calendar?from=2026-10-12&to=2026-10-18`

| Part | Value | Meaning |
|---|---|---|
| Scheme | `https` | HTTP inside TLS encryption ([[Reverse proxies and TLS]]) |
| Host | `tasks.ahmedatif.in` | Which server; DNS turns it into an IP address |
| Path | `/api/v1/calendar` | Which thing on that server. Hono matches routes on this |
| Query string | `from=…&to=…` | Extra parameters, after `?`, separated by `&` |

Scheme + host + port is the **origin** ([[Origin]]), the unit browsers use for security decisions.

## Methods: what you want done

| Method | Meaning | Safe? | Idempotent? | In our app |
|---|---|---|---|---|
| `GET` | Read something | yes | yes | `GET /api/v1/me`, `GET /healthz` |
| `POST` | Do something / create something | no | no (ours are, see note) | `POST /api/auth/sign-in/social`, `POST /api/v1/series` |
| `PUT` | Replace this thing with what I send | no | yes | v0.3: "this occurrence is cancelled" |
| `PATCH` | Change some fields of this thing | no | not necessarily | `PATCH /api/v1/series/:id` (v0.2): change a class's time |
| `DELETE` | Remove this thing | no | yes | v0.3: undo a cancellation |

Note: `POST` isn't idempotent by definition, but ours are made so: the app picks the new row's id itself, so a retried `POST /api/v1/series` with the same id finds the row already there and makes no second one ([[Idempotency and retries]]).

- **Safe** means it changes nothing on the server. A safe request can be repeated, prefetched or cached freely. That's why our CSRF check (in [[Middleware]]) only looks at unsafe methods.
- **Idempotent** means doing it twice has the same effect as doing it once. "Set my class to cancelled" twice leaves it cancelled; "add a task" twice makes two tasks. This matters a lot offline: a request the phone retries after a lost answer must not double anything (D-042).

## Headers you'll meet in this repo

| Header | Direction | What it does here |
|---|---|---|
| `Host` | request | Which site the request is for. Vite keeps it as `localhost:5173` so Better Auth's origin check passes ([[Dev server proxy]]) |
| `Cookie` | request | The browser sends the session cookie back on every request ([[Cookies and sessions]]) |
| `Set-Cookie` | response | The server gives the browser a cookie (at sign-in, and when the 30-day expiry slides) |
| `Content-Type` | both | What the body is: `application/json`, `application/problem+json` (our errors), `text/html` |
| `Cache-Control` | response | `no-store` on `/me` (personal data), `immutable` on hashed web assets, `no-cache` on `index.html` |
| `Origin` | request | The page's origin on state-changing requests. Used for CSRF checks |
| `X-Request-Id` | response | Our id for this request; the same id is in the log line and in error bodies |
| `X-Forwarded-For` | request | Set by Caddy: the visitor's real IP, since the API itself only sees Caddy |

## Status codes: how it went

The first digit is the family:

| Family | Meaning | Ones we use |
|---|---|---|
| 2xx | It worked | `200 OK`, `201 Created` (a new row was made), `204 No Content` (done, nothing to send back: our `DELETE`s) |
| 3xx | Look elsewhere | `302 Found`: the Google sign-in redirects. `304 Not Modified`: "your cached copy is still good" |
| 4xx | **Your** request is wrong | `400` malformed JSON, `401` not signed in, `403` signed in but not allowed, `404` no such thing, `409` clashes with what's stored, `413` body too big, `422` valid JSON but invalid fields |
| 5xx | **The server** failed | `500` a bug, `503` the database is down (`/healthz`) |

`401` vs `403` trips everyone up: 401 means "I don't know who you are" (sign in), 403 means "I know who you are, and the answer is no". Every error body we send has the same shape, described in [[Error responses]].

In our API, every error has a name (its `code`) and a usual status, all in one table:

*From `apps/api/src/http/errors.ts`:*
```ts
/** The usual status and a short human title for each code. */
const CODES: Record<ErrorCode, { status: ContentfulStatusCode; title: string }> = {
  malformed_request: { status: 400, title: 'Malformed request' },
  unauthenticated: { status: 401, title: 'Not signed in' },
  forbidden: { status: 403, title: 'Not allowed' },
  not_found: { status: 404, title: 'Not found' },
  conflict: { status: 409, title: 'Conflict' },
  validation_failed: { status: 422, title: 'Validation failed' },
  internal_error: { status: 500, title: 'Something went wrong' },
};
```

`413` isn't in the table: a too-big body is reported as `malformed_request` with its status changed to 413. `503` isn't either, because only `/healthz` sends it, and not as an error body. `Record<ErrorCode, …>` makes the type checker insist that every code has a row ([[TypeScript essentials]]).

## Stateless, so cookies

HTTP itself remembers nothing between requests: request 2 doesn't know request 1 happened. So "you're signed in" has to travel *with every request*. That's the cookie's job ([[Cookies and sessions]]). The server looks it up each time.

## JSON

The body format both sides use: JavaScript-object-shaped text (`{"sha":"dev","dbOk":true}`). Only strings, numbers, booleans, `null`, arrays and objects survive, which is why dates travel as strings like `"2026-10-12T14:35:40.462Z"` ([[Dates, times and instants]]).

## Check yourself
- Predict the status code: `/api/v1/me` with no cookie; with a cookie for an email that was later removed from the allowlist; `/api/v1/doesnotexist` with a valid cookie.
- Why is `GET` safe to retry automatically, while a retried `POST /tasks` could make two tasks? What does D-042 do about it?
- Run `curl -i http://localhost:5173/api/v1/me`. Which header tells the client the body is an error, before it even reads the body?
- The API never sees your phone's IP directly. Which header carries it, and who sets it?
