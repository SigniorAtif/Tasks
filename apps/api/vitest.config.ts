import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Like the package scripts' `--env-file-if-exists=../../.env`, so a developer
// can point TEST_DATABASE_URL somewhere else. Variables already set win.
const rootEnvFile = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile);

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    env: { NODE_ENV: 'test' },
    // Creates the test database before any test runs.
    globalSetup: ['src/test/global-setup.ts'],
    // The integration tests share one real Postgres database (D-017) and wipe
    // it between tests, so test files must not run at the same time.
    fileParallelism: false,
  },
});
