import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testMatch: '*.spec.ts',
  timeout: 120000,
  workers: 1,
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
    actionTimeout: 15000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    env: { OPENAI_API_KEY: '' },
    command: 'npm start',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
