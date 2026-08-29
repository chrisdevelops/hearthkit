import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright configuration for this project's end-to-end tests.
 *
 * By default `pnpm test:e2e` builds the app, starts it with `next start`, and runs the specs in
 * `e2e/` against it. Set `SMOKE_TEST_BASE_URL` to point the same specs at a server that is already
 * running — a container you just built, a preview deployment, or a `pnpm dev` server on another
 * port — and Playwright starts nothing itself.
 *
 *   SMOKE_TEST_BASE_URL=http://127.0.0.1:8080 pnpm test:e2e
 */

/** An empty value counts as unset, the same rule hearthkit config applies to every variable. */
const configuredBaseUrl = process.env.SMOKE_TEST_BASE_URL?.trim() ?? ''

/** Where the specs point; the default matches the port `next start` and the container both listen on. */
const baseURL = configuredBaseUrl === '' ? 'http://127.0.0.1:3000' : configuredBaseUrl

/** Nothing is started when the base URL was supplied, because that server is already up. */
const startsItsOwnServer = configuredBaseUrl === ''

const isContinuousIntegration = (process.env.CI ?? '') !== ''

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isContinuousIntegration,
  retries: isContinuousIntegration ? 1 : 0,
  workers: isContinuousIntegration ? 1 : undefined,
  reporter: isContinuousIntegration ? [['github'], ['list']] : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: startsItsOwnServer
    ? {
        // `next start` serves the production build, which is what the smoke test should exercise:
        // the theme is compiled the same way the deployed image compiles it.
        command: 'pnpm build && pnpm start',
        url: baseURL,
        reuseExistingServer: !isContinuousIntegration,
        timeout: 180_000,
      }
    : undefined,
})
