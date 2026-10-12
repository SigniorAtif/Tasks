// In production the API also serves the built PWA (apps/web/dist) from
// STATIC_DIR, so the app and its API share one origin and Caddy only has to
// forward everything to one place. In development this is off: Vite serves
// the PWA on :5173 and forwards /api to us.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { paths } from '@tasks/core';
import type { Hono } from 'hono';
import type { AppEnv } from './http/context.ts';
import type { Logger } from './logger.ts';

/**
 * Vite puts a hash of each file's contents in its name under /assets
 * (`index-3f9a1c.js`). A changed file gets a new name, so the old one can be
 * cached for a year without ever going stale.
 */
const IMMUTABLE = 'public, max-age=31536000, immutable';
/**
 * Everything else keeps its name between releases (index.html, sw.js, the
 * manifest, icons). `no-cache` means "you may keep a copy, but check with us
 * before using it", so a new release reaches the phone on the next visit.
 */
const REVALIDATE = 'no-cache';

/** Requests the PWA must never answer: they belong to the API, even when no route matches. */
function belongsToApi(requestPath: string): boolean {
  return requestPath === '/api' || requestPath.startsWith('/api/') || requestPath === paths.healthz;
}

export function staticSite(app: Hono<AppEnv>, dir: string, logger: Logger): void {
  if (!existsSync(path.join(dir, 'index.html'))) {
    logger.warn({ dir }, 'STATIC_DIR has no index.html; is the PWA built?');
  }
  const file = serveStatic({ root: dir });
  const appShell = serveStatic({ root: dir, path: 'index.html' });
  const nothing = async () => {};

  app.get('*', async (c, next) => {
    const requestPath = c.req.path;
    if (belongsToApi(requestPath)) return next();

    // 1. A real file: /, /sw.js, /assets/index-3f9a1c.js, …
    const found = await file(c, nothing);
    if (found) {
      found.headers.set(
        'Cache-Control',
        requestPath.startsWith('/assets/') ? IMMUTABLE : REVALIDATE,
      );
      return found;
    }
    // A missing hashed asset is a real 404: answering it with HTML would make
    // the browser try to run index.html as JavaScript.
    if (requestPath.startsWith('/assets/')) return next();

    // 2. Anything else is a page of the single-page app (/login, /settings):
    // send index.html and let the PWA's router draw it.
    const shell = await appShell(c, nothing);
    if (!shell) return next();
    shell.headers.set('Cache-Control', REVALIDATE);
    return shell;
  });
}
