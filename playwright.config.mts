import { defineConfig, devices } from '@playwright/test';
import process from 'node:process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

export default defineConfig({
  expect: { timeout: 5_000 },
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: true,
  outputDir: 'test-results',
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : [['line']],
  retries: 0,
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    screenshot: 'only-on-failure',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    video: 'off',
  },
  webServer: {
    command: `${npmCommand} --prefix client run preview -- --host 127.0.0.1 --port 4173`,
    reuseExistingServer: false,
    timeout: 60_000,
    url: 'http://127.0.0.1:4173',
  },
  workers: process.env.CI ? 1 : 2,
});
