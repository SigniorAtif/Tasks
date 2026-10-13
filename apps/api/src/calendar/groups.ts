// The `schedule_group` table: "Classes · Sem 3", "Health". Every function takes
// a `UserScope` (so Postgres' row-level security applies) and still filters by
// `scope.userId` itself (D-034: one forgotten filter is never a leak).

import type { createGroupSchema, ScheduleGroup, updateGroupSchema } from '@tasks/core';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';
import { scheduleGroup } from '../db/schema.ts';
import type { UserScope } from '../db/user-scope.ts';
import { toGroup } from './rows.ts';
import { alreadyCreated, type Created, guardedWrite } from './writes.ts';

/** A validated `POST` body: the create schema's output, with its defaults filled in. */
export type NewGroup = z.output<typeof createGroupSchema>;
/** A validated `PATCH` body: only the fields being changed. */
export type GroupChanges = z.output<typeof updateGroupSchema>;

const mine = (scope: UserScope, id: string) =>
  and(eq(scheduleGroup.userId, scope.userId), eq(scheduleGroup.id, id));

/** Every group, archived ones too: oldest `activeFrom` first, then by name. */
export async function listGroups(scope: UserScope): Promise<ScheduleGroup[]> {
  const rows = await scope.tx
    .select()
    .from(scheduleGroup)
    .where(eq(scheduleGroup.userId, scope.userId))
    // The id last, so two groups with the same start and name keep a fixed order.
    .orderBy(asc(scheduleGroup.activeFrom), asc(scheduleGroup.name), asc(scheduleGroup.id));
  return rows.map(toGroup);
}

export async function findGroup(scope: UserScope, id: string): Promise<ScheduleGroup | undefined> {
  const [row] = await scope.tx.select().from(scheduleGroup).where(mine(scope, id));
  return row && toGroup(row);
}

/** Inserts the group, or finds the one an earlier attempt with the same id made. */
export async function createGroup(
  scope: UserScope,
  input: NewGroup,
): Promise<Created<ScheduleGroup>> {
  const [row] = await guardedWrite(Object.keys(input), () =>
    scope.tx
      .insert(scheduleGroup)
      .values({ ...input, userId: scope.userId })
      .onConflictDoNothing({ target: scheduleGroup.id })
      .returning(),
  );
  if (row) return { row: toGroup(row), created: true };
  return alreadyCreated(await findGroup(scope, input.id));
}

/** Applies the changes and returns the new row; `undefined` if there's no such group. */
export async function updateGroup(
  scope: UserScope,
  id: string,
  changes: GroupChanges,
): Promise<ScheduleGroup | undefined> {
  const sent = Object.keys(changes);
  // An empty PATCH changes nothing: answer with the row as it is.
  if (sent.length === 0) return findGroup(scope, id);
  const [row] = await guardedWrite(sent, () =>
    scope.tx.update(scheduleGroup).set(changes).where(mine(scope, id)).returning(),
  );
  return row && toGroup(row);
}

/** Deletes the group, its series and their overrides (the foreign keys cascade). */
export async function deleteGroup(scope: UserScope, id: string): Promise<boolean> {
  const deleted = await scope.tx
    .delete(scheduleGroup)
    .where(mine(scope, id))
    .returning({ id: scheduleGroup.id });
  return deleted.length > 0;
}

/**
 * Deletes this user's groups with any of these names, and their series: how
 * the seed script replaces a timetable it wrote before. Returns how many went.
 */
export async function deleteGroupsNamed(
  scope: UserScope,
  names: readonly string[],
): Promise<number> {
  if (names.length === 0) return 0;
  const deleted = await scope.tx
    .delete(scheduleGroup)
    .where(and(eq(scheduleGroup.userId, scope.userId), inArray(scheduleGroup.name, [...names])))
    .returning({ id: scheduleGroup.id });
  return deleted.length;
}
