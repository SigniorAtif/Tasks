// `/api/v1/series`: list, create, read, change and delete series. Same shape
// and status codes as `/api/v1/groups` (routes/groups.ts).

import { createSeriesSchema, paths, type SeriesList, updateSeriesSchema } from '@tasks/core';
import type { Hono } from 'hono';
import {
  createSeries,
  deleteSeries,
  findSeries,
  listSeries,
  updateSeries,
} from '../calendar/series.ts';
import type { Database } from '../db/client.ts';
import type { AppEnv } from '../http/context.ts';
import { jsonBody } from '../http/json-body.ts';
import { noSuchRow, rowId } from '../http/row-id.ts';
import { getProfile } from '../profile/profile.ts';

export function seriesRoutes(app: Hono<AppEnv>, deps: { db: Database }): void {
  const one = `${paths.series}/:id` as const;

  app.get(paths.series, async (c) => {
    const body: SeriesList = { series: await c.var.asUser(listSeries) };
    return c.json(body);
  });

  app.post(paths.series, async (c) => {
    const input = await jsonBody(c, createSeriesSchema);
    // No zone sent: the series takes the user's. The profile isn't one of the
    // row-level-security tables (and tasks_app may not read it), so it's read
    // here, before the scoped transaction, the same way /me reads it.
    const tzid = input.tzid ?? (await getProfile(deps.db, c.get('user').id)).tzid;
    const { row, created } = await c.var.asUser((scope) => createSeries(scope, { ...input, tzid }));
    if (!created) return c.json(row, 200);
    c.header('Location', `${paths.series}/${row.id}`);
    return c.json(row, 201);
  });

  app.get(one, async (c) => {
    const id = rowId(c.req.param('id'), 'series');
    const found = await c.var.asUser((scope) => findSeries(scope, id));
    if (!found) throw noSuchRow('series');
    return c.json(found);
  });

  app.patch(one, async (c) => {
    const id = rowId(c.req.param('id'), 'series');
    const changes = await jsonBody(c, updateSeriesSchema);
    const updated = await c.var.asUser((scope) => updateSeries(scope, id, changes));
    if (!updated) throw noSuchRow('series');
    return c.json(updated);
  });

  app.delete(one, async (c) => {
    const id = rowId(c.req.param('id'), 'series');
    const deleted = await c.var.asUser((scope) => deleteSeries(scope, id));
    if (!deleted) throw noSuchRow('series');
    return c.body(null, 204);
  });
}
