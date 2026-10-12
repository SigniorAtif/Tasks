import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
    // Property tests run 1,000 cases each; with coverage on, a few take longer than the 5 s default.
    testTimeout: 60_000,
    coverage: {
      provider: 'v8',
      include: ['src/recurrence/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/__fixtures__/**'],
      // The only coverage gate in the repo (D-017): the recurrence engine, where bugs are subtle.
      thresholds: { branches: 90 },
    },
  },
});
