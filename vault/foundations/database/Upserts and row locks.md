# Upserts and row locks

> **Builds on:** [[Postgres and SQL basics]] · [[Transactions]] · [[Idempotency and retries]]

Some rows should exist at most once per *something*: one override per occurrence, one profile per user. Writing them is "make this row say X, whether or not it exists yet". That sounds like two steps, look and then insert or update, and two steps are exactly where two requests at the same moment trip over each other. This note is about doing it in one step, the **upsert**, and about the **row lock** that keeps a row still while you finish with it.

## The race in "look, then write"

The obvious code reads first:

```text
select the row for (series, date)
if there is one: update it
else: insert a new one
```

Now two requests arrive together: you tapped **Me**, the phone retried, both reach the server within a millisecond. Each runs its own [[Transactions|transaction]]. Each `select` finds nothing, because neither has inserted yet. Each goes down the "insert" branch. The first insert works. The second hits the table's **unique constraint**, the rule that no two rows share (series, original date), and Postgres refuses it: `duplicate key value violates unique constraint`. The server answers 500 for a request that did nothing wrong.

This isn't hypothetical. While building ticket #8 we swapped our real code for exactly that select-then-write version and ran the test that fires six requests at one occurrence at once. Several of the six came back 500.

The gap is between the look and the write. Nothing stops another transaction from changing the answer to "is there a row?" in between, and under Postgres's default isolation level, **READ COMMITTED**, each statement sees what was committed before it began, nothing later.

## The upsert: one statement decides

Postgres can do "insert, or update the row that's in the way" as a single statement:

```sql
insert into occurrence_override (user_id, series_id, kind, original_date, status, cancel_reason)
values ($1, $2, 'modified', '2026-10-14', 'cancelled', 'skipped')
on conflict (series_id, original_date)
do update set status = excluded.status, cancel_reason = excluded.cancel_reason
returning *;
```

Read it in order:

- `on conflict (series_id, original_date)` names the unique constraint to watch. Postgres finds the constraint whose columns those are.
- If no row has that pair, the insert happens.
- If one does, the insert doesn't happen. The `do update` runs on the row that's already there instead.
- `excluded` is the row you *tried* to insert, so `excluded.status` means "the status from this request".
- `returning *` hands back the row as it now is, inserted or updated, so the code never needs a second read to learn which.

The point is that Postgres makes the insert-or-update choice *inside* the unique index, at the moment of writing, not from an earlier look. When two upserts race, one inserts. The other notices the conflict, waits for the first transaction to finish, and then updates the first one's row. No duplicate-key error is possible, which is why it's the tool for idempotent writes ([[Idempotency and retries]]: the same body twice must leave the same state).

v0.2 already used the milder cousin, `on conflict (id) do nothing`, for creates: a retried create finds its own row and changes nothing. A cancel is different. The second request may carry a *different* reason ("Me", then "Prof"), and it should win, so the conflict branch updates instead of doing nothing.

## Row locks: the row holds still until commit

Any `update` or `delete`, including the update inside an upsert, takes a **row lock** on that row. Another transaction that wants to change the same row waits until the first one commits or rolls back. The lock is held to the end of the *transaction*, not just the statement.

That second fact is what makes a follow-up statement safe. Our occurrence write has a rule: when a restore leaves an override saying nothing at all (no status, no reason, no move, no note), the row is deleted, so the table never fills with empty rows. In code that's a second statement in the same transaction:

```sql
-- 1. the upsert above, which locks the row
-- 2. then:
delete from occurrence_override
where id = $row_id and status is null and cancel_reason is null and note is null -- and the other fields
```

Between statement 1 and statement 2, could another request sneak in and, say, cancel the class again, so we'd delete a row that isn't empty any more? No. Statement 1 locked the row, and nobody else can change it until we commit. Statement 2 sees exactly what statement 1 left.

## Why not one statement?

The spec for ticket #8 asked for the upsert and the delete "in the same statement". Postgres can chain writes in one statement with a `with` clause (a common table expression):

```sql
with up as (insert … on conflict … do update … returning *)
delete from occurrence_override where id in (select id from up where … all empty …);
```

It looks right and doesn't work. Every part of one statement reads the same **snapshot**: the database as it was when the statement started. The `delete` can't see the row the `insert` just wrote, because that row didn't exist in the snapshot. And if the upsert *updated* an existing row, the delete finds the old version, which this same statement already changed, and Postgres quietly skips it. Either way, nothing is deleted, and you get the empty row the rule exists to prevent.

Two other one-statement routes were weighed:

- **`merge`** (Postgres 15+) can insert, update or delete in one statement. But when two `merge`s race to insert the same key, the loser gets the duplicate-key error. That's the very failure we started with.
- **A trigger** that deletes empty rows after every update would run inside the statement. It also hides behaviour where nobody reading the route would look for it.

So we kept the spec's goal and changed its letter: two statements, one transaction, the lock between them. What lost:
- The literal "one statement" wording in the ticket.
- A restore of a class that was never cancelled inserts an empty row and deletes it at once. That's two cheap writes to answer "already as you asked", and the request is rare.

## Where you'll meet these

- [[Cancelling one occurrence]]: the upsert-then-delete, and the test that fires requests in parallel.
- [[Row-level security]]: a `do update` also has to pass the row-level security policy, like any update.
- [[Idempotency and retries]]: why the same request twice must be harmless.

## Check yourself

1. Two requests try to cancel the same class at once using "select, then insert or update". Walk through why one of them gets a 500.
2. In `on conflict … do update set status = excluded.status`, what is `excluded`?
3. Why can the delete safely run as a *second* statement, when another request might arrive between the two?
4. Why can't a `with … delete` in the same statement delete the row the upsert just wrote?
5. Why wasn't `merge` the answer, even though it can delete?
