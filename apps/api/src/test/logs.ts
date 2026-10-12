import { createLogger, type Logger } from '../logger.ts';

/** A logger that keeps its JSON lines in memory, so tests can assert on what was logged. */
export function captureLogs(): {
  logger: Logger;
  lines: Record<string, unknown>[];
  text: () => string;
} {
  const lines: Record<string, unknown>[] = [];
  const raw: string[] = [];
  const logger = createLogger(
    { NODE_ENV: 'test', LOG_LEVEL: 'debug' },
    {
      write(line: string) {
        raw.push(line);
        lines.push(JSON.parse(line) as Record<string, unknown>);
      },
    },
  );
  return { logger, lines, text: () => raw.join('') };
}
