// Browser tests for the website. Runs against a dev server on port 3211 (started if none is
// running), against the production build with PW_SERVER=start (after `npm run build -w web`;
// what CI does), or against any deployment with PW_BASE_URL=https://….
//   npx playwright install chromium   # once
//   npm run e2e -w web
//   SHOTS=1 npm run e2e -w web -- screenshots   # also writes e2e/screenshots/*.png
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PW_PORT ?? 3211);
const BASE = process.env.PW_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: { baseURL: BASE, trace: 'retain-on-failure', ...devices['Desktop Chrome'] },
  webServer: process.env.PW_BASE_URL
    ? undefined
    : {
        command: process.env.PW_SERVER === 'start' ? `npx next start -p ${PORT}` : `npx next dev -p ${PORT}`,
        url: BASE,
        reuseExistingServer: true,
        timeout: 180_000,
        env: { WATCHPACK_POLLING: 'true' },
      },
});
