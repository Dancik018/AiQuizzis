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
    // Deliberately non-production values: no live credentials or Supabase requests
    // are needed to reject requests that have no authenticated session.
    env: {
      OPENAI_API_KEY: '',
      SUPABASE_URL: 'https://aiquiz-test.invalid',
      SUPABASE_PUBLISHABLE_KEY: 'test-only-not-a-real-key',
      GOOGLE_AUTH_ENABLED: 'true',
      APP_URL: 'http://localhost:3000',
      EMAIL_AUTH_ENABLED: 'false',
    },
    command: 'npm start',
    url: 'http://localhost:3000',
    reuseExistingServer: false,
    timeout: 120000,
  },
});
