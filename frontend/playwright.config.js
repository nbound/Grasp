import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    actionTimeout: 10000,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: [
    {
      command: 'node ../server/tests/browserFixture.mjs',
      url: 'http://127.0.0.1:54329/health',
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 4173 --strictPort',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: false,
      env: {
        VITE_SUPABASE_URL: 'http://127.0.0.1:54329',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'fixture-public',
        VITE_GAME_SERVER_URL: 'http://127.0.0.1:3009',
        VITE_STUDENT_DEMO: 'false',
        VITE_TURNSTILE_SITE_KEY: '',
      },
    },
  ],
})
