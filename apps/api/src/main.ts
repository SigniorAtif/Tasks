// The server's entry point: `node src/main.ts` (Node runs the TypeScript
// directly). It reads the environment, builds the real dependencies, starts
// listening, and shuts down cleanly when Docker or Ctrl+C asks it to stop.

import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { createAuth } from './auth/auth.ts';
import { createDb } from './db/client.ts';
import { createPool } from './db/pool.ts';
import { loadEnv } from './env.ts';
import { createLogger } from './logger.ts';

const env = loadEnv();
const logger = createLogger(env);

const pool = createPool(env.DATABASE_URL);
// An idle pooled connection can break (say, Postgres restarts). pg reports it
// here; without a listener Node would treat it as a crash.
pool.on('error', (error) => logger.error({ err: error }, 'idle database connection failed'));

const db = createDb(pool);
const auth = createAuth({ env, db, logger });
if (!env.GOOGLE_CLIENT_ID) {
  logger.warn(
    'GOOGLE_CLIENT_ID is not set: Google sign-in is off (use `pnpm dev:session` locally)',
  );
}

const app = createApp({ env, logger, pool, db, auth, now: () => new Date() });

const server = serve({ fetch: app.fetch, hostname: env.HOST, port: env.PORT }, (address) => {
  logger.info(
    { host: address.address, port: address.port, sha: env.GIT_SHA, nodeEnv: env.NODE_ENV },
    'listening',
  );
});

// `docker stop` sends SIGTERM and waits 10 s before killing the process.
// Stop accepting new connections, let in-flight requests finish, close the
// database pool, then exit.
// If something hangs, give up after 8 s so Docker never has to SIGKILL us.
let stopping = false;
function shutdown(signal: NodeJS.Signals): void {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'shutting down');
  setTimeout(() => {
    logger.error('shutdown took too long; exiting anyway');
    process.exit(1);
  }, 8_000).unref();

  server.close(async (error) => {
    if (error) logger.error({ err: error }, 'error while closing the HTTP server');
    await pool.end();
    process.exit(error ? 1 : 0);
  });
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
