// `/api/v1/groups`: list, create, read, change and delete schedule groups.
// Behind `requireSession` and `userScope` (see app.ts), so `c.var.asUser`
// runs each request's queries as the signed-in user. The status codes are
// described once, in the comment block of `packages/core/src/api.ts`.

import { createGroupSchema, type GroupList, paths, updateGroupSchema } from '@tasks/core';
import type { Hono } from 'hono';
import {
  createGroup,
  deleteGroup,
  findGroup,
  listGroups,
  updateGroup,
} from '../calendar/groups.ts';
import type { AppEnv } from '../http/context.ts';
import { jsonBody } from '../http/json-body.ts';
import { noSuchRow, rowId } from '../http/row-id.ts';

export function groupsRoutes(app: Hono<AppEnv>): void {
  const one = `${paths.groups}/:id` as const;

  app.get(paths.groups, async (c) => {
    const body: GroupList = { groups: await c.var.asUser(listGroups) };
    return c.json(body);
  });

  app.post(paths.groups, async (c) => {
    const input = await jsonBody(c, createGroupSchema);
    const { row, created } = await c.var.asUser((scope) => createGroup(scope, input));
    // 201 + where the new row lives; a repeat of the same create is a plain 200.
    if (!created) return c.json(row, 200);
    c.header('Location', `${paths.groups}/${row.id}`);
    return c.json(row, 201);
  });

  app.get(one, async (c) => {
    const id = rowId(c.req.param('id'), 'group');
    const group = await c.var.asUser((scope) => findGroup(scope, id));
    if (!group) throw noSuchRow('group');
    return c.json(group);
  });

  app.patch(one, async (c) => {
    const id = rowId(c.req.param('id'), 'group');
    const changes = await jsonBody(c, updateGroupSchema);
    const group = await c.var.asUser((scope) => updateGroup(scope, id, changes));
    if (!group) throw noSuchRow('group');
    return c.json(group);
  });

  app.delete(one, async (c) => {
    const id = rowId(c.req.param('id'), 'group');
    const deleted = await c.var.asUser((scope) => deleteGroup(scope, id));
    if (!deleted) throw noSuchRow('group');
    return c.body(null, 204);
  });
}
