import { expect, test } from '@playwright/test'

/**
 * The smoke test every hearthkit project starts with: the home page renders with the theme applied,
 * and the health endpoint the container and the uptime monitor poll answers 200.
 *
 * Run it against the dev or production server with `pnpm test:e2e`, or against an already running
 * server (a container, a preview deployment) by setting `SMOKE_TEST_BASE_URL`. Keep both tests as
 * you add pages: they are the two things that break silently when a dependency or the theme wiring
 * moves.
 */

test('the home page renders with the hearthkit theme applied', async ({ page }) => {
  const response = await page.goto('/')

  expect(response?.status()).toBe(200)

  // PageHeader renders the page title as the one h1 on the page.
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  // ThemeModeToggle only renders inside ThemeModeProvider, so seeing it proves the provider is
  // wrapping the app in app/layout.tsx.
  await expect(page.getByRole('button', { name: 'Toggle theme' })).toBeVisible()

  // The theme stylesheet is what defines the design tokens. Losing its @import from
  // app/globals.css still serves a 200, so the token value is the assertion that catches it.
  const primaryTokenValue = await page.evaluate(() =>
    window.getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),
  )
  expect(primaryTokenValue).not.toBe('')

  // The @source line in app/globals.css is what makes Tailwind generate the utility classes used
  // inside @hearthkit/ui. Without it the markup still carries the class names and nothing errors:
  // the components simply render unstyled. A real background colour on a button is the difference.
  const buttonBackgroundColors = await page
    .getByRole('button')
    .evaluateAll((buttons) =>
      buttons.map((button) => window.getComputedStyle(button).backgroundColor),
    )
  expect(
    buttonBackgroundColors.some(
      (backgroundColor) =>
        backgroundColor !== 'rgba(0, 0, 0, 0)' && backgroundColor !== 'transparent',
    ),
  ).toBe(true)
})

test('the health endpoint answers 200 with an ok report', async ({ request }) => {
  const response = await request.get('/health')

  expect(response.status()).toBe(200)

  // The body is @hearthkit/observability's health report: an ok status, plus one entry per health
  // check the app registered in app-health-checks.ts. A failing check answers 503 instead.
  const healthReport: unknown = await response.json()
  expect(healthReport).toMatchObject({ status: 'ok' })
})
