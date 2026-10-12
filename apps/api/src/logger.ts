// Structured logging with pino: every log line is one JSON object on stdout,
// e.g. {"level":30,"time":1760262000000,"requestId":"…","msg":"request"}.
// Machines (Docker, a log search) can filter on fields; in development
// pino-pretty turns the same lines into readable coloured text.

import { type DestinationStream, type Logger, pino } from 'pino';
import type { Env } from './env.ts';

export type { Logger };

/**
 * Fields that must never reach a log, wherever they appear one level deep.
 * Our own log calls don't include headers or secrets; this is the safety net
 * for the day someone logs a whole request or config object.
 */
const REDACT_PATHS = [
  'cookie',
  'authorization',
  'password',
  'secret',
  'token',
  'headers.cookie',
  'headers.authorization',
  'headers["set-cookie"]',
  '*.cookie',
  '*.authorization',
  '*.password',
  '*.secret',
  '*.token',
  '*.headers.cookie',
  '*.headers.authorization',
  '*.headers["set-cookie"]',
  'BETTER_AUTH_SECRET',
  'GOOGLE_CLIENT_SECRET',
  'DATABASE_URL',
  '*.BETTER_AUTH_SECRET',
  '*.GOOGLE_CLIENT_SECRET',
  '*.DATABASE_URL',
];

/**
 * Builds the app's logger. Tests pass a `destination` to capture the output;
 * otherwise development pretty-prints and everything else writes raw JSON.
 */
export function createLogger(
  env: Pick<Env, 'NODE_ENV' | 'LOG_LEVEL'>,
  destination?: DestinationStream,
): Logger {
  const options = {
    level: env.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
  };
  if (destination) return pino(options, destination);
  if (env.NODE_ENV === 'development') {
    return pino({ ...options, transport: { target: 'pino-pretty' } });
  }
  return pino(options);
}
