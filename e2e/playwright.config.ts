// The end-to-end test: Playwright drives a real Chromium against the built app
// and the API with a real Postgres. `pnpm e2e` from the repo root builds the
// app first. Once per machine: pnpm --filter @tasks/e2e exec playwright install chromium

import { defineConfig, devices } from '@playwright/test';
import { API_MAIN, ORIGIN, SERVER_ENV } from './support/server.ts';

export default defineConfig({
  testDir: 'tests',
  // The tests share one database, so one at a time. No retries: a retry would
  // add the same class a second time, and a flaky test should fail, not hide.
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: ORIGIN,
    // Kept for a failed test: open it with `playwright show-trace`.
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      // Phone-sized, as the app is mostly used: the calendar shows one day.
      use: { ...devices['Desktop Chrome'], viewport: { width: 412, height: 915 } },
    },
  ],
  webServer: {
    command: `node support/prepare.ts && node "${API_MAIN}"`,
    env: SERVER_ENV,
    // Ready once /healthz answers 200, which means it reached the database too.
    // The address the API listens on, so `localhost` resolving to IPv6 first can't stall it.
    url: `http://127.0.0.1:${SERVER_ENV.PORT}/healthz`,
    // Never test against something already on the port: it could be older code.
    reuseExistingServer: false,
    stderr: 'pipe',
  },
});
