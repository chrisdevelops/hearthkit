import { describe, expect, it } from 'vitest'
import {
  expectedSpecFilePaths,
  runScaffoldVariant,
  scaffoldVariantPlans,
  type PlaywrightTestOutcome,
  type ScaffoldVariantOutcome,
} from '../test-fixtures/create-scaffold-variant-harness.ts'

/**
 * The three variants plan 4.10 names, each taken from an empty directory to a booted app with its
 * Playwright flows run. These are the slowest gates in the repo: minutes each, Docker required,
 * Chromium downloaded on first run, a Stripe test-mode key required by the every-package variant.
 *
 * They are excluded from `pnpm --filter @hearthkit/create test` by `vitest.config.ts` and run only
 * under `HEARTHKIT_SCAFFOLD_GATES=1`, which is what `pnpm --filter @hearthkit/create test:scaffold`
 * sets. An environment variable rather than a vitest project, so that a plain `vitest run` from any
 * direction stays fast and only an explicit variable widens it.
 *
 * Before running them: `docker compose up -d --wait` at the repo root for Postgres and MinIO, and
 * the Stripe test-mode pair in the git-ignored root `.env`. Mailpit is NOT the shared one — the
 * harness starts a container of its own on reserved ports, because @hearthkit/email's gates assert
 * exact message counts on the shared instance.
 *
 * A skipped Playwright test is a failure here. `payments-checkout-flow.spec.ts` skips itself when
 * STRIPE_SECRET_KEY is absent, and plan 4.8 says these run live and do not skip, so the harness
 * refuses to start the every-package variant without the key rather than reporting a green run that
 * never touched Stripe.
 */

/** Asserts the parts of a variant every one of the three must satisfy, so each gate only states what is its own. */
function expectVariantBootedAndPassedItsFlows(outcome: ScaffoldVariantOutcome): void {
  expect(outcome.installExitCode, 'pnpm install').toBe(0)
  expect(outcome.typecheckExitCode, 'pnpm typecheck').toBe(0)
  expect(outcome.buildExitCode, 'pnpm build').toBe(0)
  expect(outcome.healthStatusCode, 'the health route of the booted app').toBe(200)

  // Every spec the selection implies ran, and none of them skipped. Both halves matter: a config
  // that matched no file exits 0 and proves nothing, and a skipped flow is not a passing flow.
  const specFilePathsRun = [
    ...new Set(outcome.playwrightTestOutcomes.map(({ specFilePath }) => specFilePath)),
  ].toSorted()
  expect(specFilePathsRun).toEqual(expectedSpecFilePaths(outcome.resolvedPackages))

  const testsThatDidNotPass = outcome.playwrightTestOutcomes.filter(
    ({ status }: PlaywrightTestOutcome) => status !== 'expected',
  )
  expect(testsThatDidNotPass).toEqual([])
  expect(outcome.playwrightExitCode, 'playwright test').toBe(0)
}

const [everyPackagePlan, noPackagePlan, authWithOrganizationsPlan] = scaffoldVariantPlans

describe('a project scaffolded by createHearthkitProject', () => {
  it('installs, typechecks, boots and passes all four flows when every package is selected', async () => {
    const { outcome, tearDown } = await runScaffoldVariant(everyPackagePlan)
    try {
      expect(outcome.resolvedPackages).toEqual([...everyPackagePlan.expectedResolvedPackages])
      expect(outcome.organizationsEnabled).toBe(false)
      expectVariantBootedAndPassedItsFlows(outcome)
    } finally {
      await tearDown()
    }
  })

  it('installs, typechecks, boots, passes the smoke test and builds its Dockerfile when no package is selected', async () => {
    const { outcome, tearDown } = await runScaffoldVariant(noPackagePlan)
    try {
      expect(outcome.resolvedPackages).toEqual([])
      expectVariantBootedAndPassedItsFlows(outcome)

      // The empty variant is the one that builds the image, because it needs no service to run: the
      // container proves the Dockerfile, the standalone output and the healthcheck, not the sections.
      expect(outcome.containerHealthStatusCode, 'the health route of the running container').toBe(
        200,
      )
      expect(
        outcome.containerLoggedStartupMessage,
        'the container startup line, which proves config loading and logging ran',
      ).toBe(true)
    } finally {
      await tearDown()
    }
  })

  it('installs, typechecks, boots and passes the auth and email flows when auth is selected with organizations', async () => {
    const { outcome, tearDown } = await runScaffoldVariant(authWithOrganizationsPlan)
    try {
      // auth pulls db and email in, so the email section and its flow ship even though nobody asked
      // for them, and the flows this variant runs are the two that follow from that.
      expect(outcome.resolvedPackages).toEqual([
        ...authWithOrganizationsPlan.expectedResolvedPackages,
      ])
      expect(outcome.organizationsEnabled).toBe(true)
      expectVariantBootedAndPassedItsFlows(outcome)
    } finally {
      await tearDown()
    }
  })
})
