// `GET /api/v1/calendar?from=2026-10-12&to=2026-10-18`: every occurrence in a
// window of at most 62 days (B7), computed here on the server (B6) by core's
// `expand()` from the user's groups, series and overrides. Occurrences are
// never stored (D-021): they're worked out again on every request.

import {
  type CalendarResponse,
  calendarQuerySchema,
  type DateWindow,
  expand,
  paths,
} from '@tasks/core';
import type { Hono } from 'hono';
import { listGroups } from '../calendar/groups.ts';
import { listOverridesIn } from '../calendar/overrides.ts';
import { listSeries } from '../calendar/series.ts';
import type { AppEnv } from '../http/context.ts';
import { validationFailed } from '../http/errors.ts';

export function calendarRoute(app: Hono<AppEnv>): void {
  app.get(paths.calendar, async (c) => {
    // A missing, malformed or too wide window is a 422 naming `from` or `to`.
    const query = calendarQuerySchema.safeParse(c.req.query());
    if (!query.success) throw validationFailed(query.error);
    const window: DateWindow = { from: query.data.from, to: query.data.to };

    // One short transaction for the three reads. A user has tens of series, so
    // loading all of them is cheaper than being clever: `expand()` skips the
    // ones that can't occur in the window.
    const rows = await c.var.asUser(async (scope) => ({
      groups: await listGroups(scope),
      series: await listSeries(scope),
      overrides: await listOverridesIn(scope, window),
    }));

    // Pure computation, after the transaction ended, so no connection waits on it.
    // Holidays and days off (`day_exception`) arrive in v0.3b.
    const occurrences = expand({ ...rows, dayExceptions: [], window });
    const body: CalendarResponse = { ...window, occurrences };
    return c.json(body);
  });
}
