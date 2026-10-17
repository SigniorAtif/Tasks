# REST resources and CRUD

> **Builds on:** [[HTTP basics]] · [[Error responses]]

[[HTTP basics]] covered what's inside one request. This note is about designing a whole API out of them: which URLs exist, which method does which job, and which status code comes back. v0.2's groups and series are the API's first real data; our routes, one by one, are in [[Calendar API]].

## Resources and URLs

A **resource** is a thing the API lets you work with, named by a URL. Resources come in two shapes:

- A **collection:** `/api/v1/series`, all your series.
- An **item:** `/api/v1/series/01a12f57-1a80-73c0-b0c8-b93a75a2a8df`, one series. Docs and route definitions write this `/api/v1/series/:id`, where `:id` is a placeholder for the real id.

The URL names the **thing** (a noun); the method says **what to do** with it (the verb). So not `/api/v1/createSeries` or `/api/v1/deleteSeries?id=…`, but `POST /api/v1/series` and `DELETE /api/v1/series/:id`. Collections are plural, and an item's URL is its collection's URL plus its id.

This style is called **REST** (representational state transfer): resources named by URLs, the standard HTTP methods, status codes for the outcome, and no memory between requests ([[HTTP basics]], "Stateless, so cookies"). Most APIs, ours included, follow the loose everyday meaning rather than the full academic one.

The `v1` in `/api/v1/` is the version. Inside it we only *add* things (D-041), so an old copy of the app still installed on a phone never breaks.

Not every resource is a table. `/api/v1/calendar` is **computed**: the server expands your series into occurrences on each request and stores none of them ([[Recurrence engine]]). There's nothing to create or delete, so it only answers `GET`.

## CRUD: four jobs, four methods

**CRUD** stands for the four things you do with stored data: **C**reate, **R**ead, **U**pdate, **D**elete. Each maps onto one method:

| Job | Method and URL | You send | Success answer |
|---|---|---|---|
| Create | `POST /api/v1/series` | The new series, including its `id` | `201` and the new row. If you already created that id: `200` and the existing row |
| Read all | `GET /api/v1/series` | Nothing | `200` and `{ "series": [ … ] }` |
| Read one | `GET /api/v1/series/:id` | Nothing | `200` and the row |
| Update | `PATCH /api/v1/series/:id` | Only the fields to change | `200` and the row after the change |
| Delete | `DELETE /api/v1/series/:id` | Nothing | `204`, no body |

`/api/v1/groups` works the same way. Why the client picks the `id` on create, and why repeating a create is safe, is [[Idempotency and retries]].

In our app, that table is five route definitions: two on the collection's URL, three on the item's.

*From `apps/api/src/routes/series.ts` (shortened):*
```ts
  const one = `${paths.series}/:id` as const;

  app.get(paths.series, async (c) => {
    const body: SeriesList = { series: await c.var.asUser(listSeries) };
    return c.json(body);
  });

  app.post(paths.series, async (c) => {
    // …
    if (!created) return c.json(row, 200);
    c.header('Location', `${paths.series}/${row.id}`);
    return c.json(row, 201);
  });

  app.get(one, async (c) => {
    // …
  });
  // … app.patch(one, …) in the same shape

  app.delete(one, async (c) => {
    const id = rowId(c.req.param('id'), 'series');
    const deleted = await c.var.asUser((scope) => deleteSeries(scope, id));
    if (!deleted) throw noSuchRow('series');
    return c.body(null, 204);
  });
```

What to notice:
- The method is the function name (`app.get`, `app.post`, `app.delete`), and the URL is its first argument: `paths.series` is `/api/v1/series`, and `one` is `/api/v1/series/:id`.
- `c.req.param('id')` reads the real id out of the `:id` placeholder.
- The status codes from the table above are written right there: `c.json(row, 201)`, `c.json(row, 200)`, `c.body(null, 204)` (a body of `null`: nothing to send).

## PATCH, not PUT, for edits

- **`PUT`** means "replace the whole thing with what I send". To rename a class you'd send every field. Worse: an older app on your phone that doesn't know about a field added later would send the series *without* it, and wipe it.
- **`PATCH`** means "change these fields": `{"title": "DBMS (lab)"}`. Fields you leave out stay as they are. In our API, a `PATCH` body is a partial object of exactly that kind. The usual convention (JSON Merge Patch, RFC 7396) adds one more rule: a field sent as `null` means "clear it", like `"untilDate": null` for "no end date any more", while a field left out means "don't touch".

`PUT` is idempotent by definition; `PATCH` isn't necessarily (a patch could say "add one more week"). Ours only ever say "set these fields to these values", so sending the same one twice leaves the same result.

## Status codes for each job

| Code | Name | When | Our example |
|---|---|---|---|
| `200` | OK | A read, an update, or a create you'd already done | `GET /api/v1/series`; a `PATCH`; the same `POST` sent again |
| `201` | Created | A create made a new row | The first `POST /api/v1/series` with a new id |
| `204` | No Content | It worked and there's nothing to send back | `DELETE /api/v1/series/:id` |
| `400` | Bad Request | The body isn't JSON at all | `malformed_request` |
| `404` | Not Found | No such id, **or it isn't yours** | Your friend asks for your series' id. We don't say `403`: that would confirm the id exists |
| `409` | Conflict | The request clashes with what's already stored | The `id` the client made is already used by a row this user can't see (`conflict`, see [[Row-level security]]) |
| `422` | Unprocessable Content | Valid JSON, wrong values | `durationMin: -30`; a calendar range wider than 62 days (`validation_failed`) |

The rule of thumb from [[Error responses]] still holds: a 4xx means the client should change something, so it isn't retried as-is.

The `404` for "not yours" comes from one helper, so every route says it the same way:

*From `apps/api/src/http/row-id.ts`:*
```ts
export function rowId(raw: string, what: 'group' | 'series'): string {
  if (!uuid.safeParse(raw).success) throw noSuchRow(what);
  return raw;
}

/** The 404 for a row that doesn't exist or belongs to someone else: the two look the same. */
export function noSuchRow(what: 'group' | 'series'): AppError {
  return new AppError('not_found', { detail: `No ${what} with that id.` });
}
```

A `:id` that isn't even a UUID (`/api/v1/series/hello`) gets the same `404` as a real id that's someone else's: no row could have it. Without `rowId`, Postgres would fail to convert `hello` to a `uuid`, and that would surface as a `500`.

## Lists come wrapped in an object

`GET /api/v1/series` answers `{ "series": [ … ] }`, not a bare `[ … ]`. An object can grow: later the list may need a `"nextCursor"` for paging through hundreds of rows, and adding a field to an object breaks no client (the app ignores fields it doesn't know). Turning a bare array into an object later would break every client at once.

The calendar does the same, and echoes the range it answered for:

```json
{ "from": "2026-10-12", "to": "2026-10-18", "occurrences": [ … ] }
```

A single item is just the row's object.

## Query strings: filters and ranges

The path says **which** resource; the query string says **how much of it** or **filtered how**:

```
GET /api/v1/calendar?from=2026-10-12&to=2026-10-18
```

- `from` and `to` are local dates, and both are included: Monday to Sunday ([[Dates, times and instants]]).
- **The server caps the width at 62 days.** A screen never needs more than a couple of months at once, and the cap stops one request (a bug, or a curious user with `curl`) from asking for ten years of classes. Wider gets `422 validation_failed`, with the error on `to`.
- Query values always arrive as text. `?from=2026-13-40` must be refused, not passed on: [[Validating input with schemas]].
- A `GET` has no body, so everything that picks the answer is in the URL. That makes the URL a natural cache key: the app caches this answer under `['calendar', '2026-10-12', '2026-10-18']` ([[Server state and caching]]).

## Check yourself
- Which method and URL would you use to rename your "Classes · Sem 3" group? To end the DBMS series after this week but keep its past? To see next week? What status does each answer on success?
- Why does an old copy of the app on your phone keep working when the server adds a `location` field to series? Would it still, if edits used `PUT`?
- `DELETE /api/v1/series/:id` answers `204`. You send it again. What comes back, and is anything wrong?
- Why `{ "series": [ … ] }` and not a bare array?
