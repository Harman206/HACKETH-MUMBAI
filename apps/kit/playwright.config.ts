import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 120_000,
  workers: 1,
  reporter: [['list']],
  use: { ...devices['Desktop Chrome'], channel: 'chromium', acceptDownloads: true, trace: 'retain-on-failure' },
});
