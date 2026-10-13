// pnpm --filter @tasks/api dev:session you@example.com
//
// Prints a session cookie for a local, allowlisted user, so you can look at
// /me in a browser or with curl before Google sign-in is set up. Works only
// when BETTER_AUTH_URL is localhost or 127.0.0.1, whatever NODE_ENV says.

import { createAuth } from '../auth/auth.ts';
import { createDevSession, isLocalOrigin } from '../auth/dev-session.ts';
import { createDb } from '../db/client.ts';
import { createPool } from '../db/pool.ts';
import { loadEnv } from '../env.ts';
import { createLogger } from '../logger.ts';

const email = process.argv[2];
if (!email) {
  console.error('usage: pnpm --filter @tasks/api dev:session <email>');
  process.exit(2);
}

const env = loadEnv();
// Checked before touching the database, so a wrong origin never gets that far.
if (!isLocalOrigin(env.BETTER_AUTH_URL)) {
  console.error(
    `dev:session refuses to run: BETTER_AUTH_URL is ${env.BETTER_AUTH_URL}, and dev sessions are for localhost or 127.0.0.1 only.`,
  );
  process.exit(1);
}

const logger = createLogger({ NODE_ENV: env.NODE_ENV, LOG_LEVEL: 'warn' });
const pool = createPool(env.DATABASE_URL);
try {
  const db = createDb(pool);
  const auth = createAuth({ env, db, logger });
  const session = await createDevSession({ env, auth, db }, email);
  const pair = `${session.cookieName}=${session.cookieValue}`;
  console.log(
    [
      `${session.createdUser ? 'Created' : 'Found'} ${session.email} (user ${session.userId}).`,
      `New session, valid until ${session.expiresAt.toISOString()}.`,
      '',
      `Cookie name:  ${session.cookieName}`,
      `Cookie value: ${session.cookieValue}`,
      '',
      'curl:',
      `  curl -H 'Cookie: ${pair}' ${env.BETTER_AUTH_URL}/api/v1/me`,
      'Browser:',
      `  DevTools → Application → Cookies → ${env.BETTER_AUTH_URL}: add the name and value above`,
      '  (Path /), then reload.',
    ].join('\n'),
  );
} catch (error) {
  console.error(`dev:session failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
