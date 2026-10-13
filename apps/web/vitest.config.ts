import { defineConfig } from 'vitest/config';

// Tests cover small pure pieces (the api helper, formatters), so they run in
// plain Node: no browser, no Vite plugins. Vitest picks this file over
// vite.config.ts.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
