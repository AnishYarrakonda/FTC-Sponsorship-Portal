import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,

  /**
   * The suite runs against `next dev`, which compiles each route the first time it is
   * requested. That compile lands inside whichever assertion happens to touch the route
   * first, so the default 30s test / 5s expect budget produced failures whose screenshots
   * showed nothing but a loading skeleton — a slow toolchain reported as a broken page.
   * A genuinely broken page still fails here, just later.
   */
  timeout: 60_000,
  expect: { timeout: 20_000 },
  /**
   * One worker whenever the suite is pointed at a real database.
   *
   * scripts/seed-test-accounts.mjs creates exactly ONE coach who can sign in and own a
   * team, and the DB enforces one team per owner — so every DB-mutating suite necessarily
   * shares that team, plus the single "dev testing" sponsor. Run in parallel they fight:
   * golden-path clears the submissions on the (team, sponsor) pair agreement-signing is
   * mid-flow on, team-verification flips the same team between incubator and existing, and
   * sponsor-approvals toggles that org's approval policy underneath everyone. Each suite
   * passes alone and the set fails at random — the worst possible signal.
   *
   * The alternative is a separate signed-in Clerk user per suite: a much larger change for
   * a suite that takes a few minutes either way.
   */
  workers: process.env.CI || process.env.SUPABASE_LOCAL ? 1 : undefined,
  reporter: [['html', { open: 'never' }]],
  globalSetup: './tests/global-setup.ts',

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
