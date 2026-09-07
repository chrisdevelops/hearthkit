import { describe, expect, it } from 'vitest'
import {
  readTemplateFileText,
  templateFileExists,
} from '../test-fixtures/app-template-tree-files.ts'
import {
  appTemplateOptionalPackageNames,
  appTemplateSectionsByOptionalPackage,
} from './app-template-contract.ts'

/**
 * The four Playwright flows, checked as files rather than run.
 *
 * A flow ships: it sits in an optional package's ownedTemplatePaths, so a generated project that
 * selected that package runs it in its own CI. That is why these gates are about what a flow may
 * hardcode and what it may call, and why the flows themselves are in the Flows tier where the
 * services are. Running them here would drag MinIO, Mailpit, Postgres and a Stripe key into every
 * pull request.
 */

/** Every flow spec with the package it belongs to and the route it starts at. */
const flowSpecEntries = appTemplateOptionalPackageNames.map((optionalPackageName) => ({
  optionalPackageName,
  ...appTemplateSectionsByOptionalPackage[optionalPackageName],
}))

/** The two flows that read mail, which are the two that can collide with @hearthkit/email's own gates. */
const mailReadingOptionalPackageNames = ['@hearthkit/email', '@hearthkit/auth'] as const

/** Mailpit endpoints that delete, which no flow of this template may ever call. */
const mailpitDeletingEndpoints = ['/api/v1/messages', '/api/v1/search']

describe('the Playwright flow per optional package', () => {
  it('ships one flow per optional package, each starting at a section route that package owns a page for', () => {
    const flowsWithNoPageToDrive: string[] = []

    for (const {
      optionalPackageName,
      flowSpecPath,
      sectionRoutePath,
      ownedTemplatePaths,
    } of flowSpecEntries) {
      const flowSpecText = readTemplateFileText(flowSpecPath)

      // A flow spec is a project deliverable, so it cannot import src/ and repeats its route as a
      // literal. This gate is the only thing keeping that literal and the map in step.
      expect(flowSpecText, `${flowSpecPath} must drive ${sectionRoutePath}`).toContain(
        `'${sectionRoutePath}'`,
      )
      expect(flowSpecText, `${flowSpecPath} (${optionalPackageName})`).toContain('@playwright/test')
      expect(flowSpecText).toMatch(/\btest\(/)

      // And the route it starts at is a page the same package owns and ships, or the flow opens a
      // 404 and every assertion after the first is unreachable.
      const sectionPagePath = `app${sectionRoutePath}/page.tsx`
      if (
        !(ownedTemplatePaths as readonly string[]).includes(sectionPagePath) ||
        !templateFileExists(sectionPagePath)
      ) {
        flowsWithNoPageToDrive.push(
          `${optionalPackageName} starts at ${sectionRoutePath}, which needs ${sectionPagePath} owned and shipped`,
        )
      }
    }

    expect(flowsWithNoPageToDrive).toEqual([])
  })

  it('reads its own mail through an environment variable and never deletes a message, so it cannot collide with @hearthkit/email gates', () => {
    // @hearthkit/email's gates clear Mailpit wholesale and then assert exact message counts. A flow
    // that deleted, or that read an unscoped list, breaks them and is broken by them. Both halves
    // are needed: scoping every read by a run-unique recipient, and taking the Mailpit address from
    // the environment so this repo can point the flows at a Mailpit of their own while a generated
    // project keeps the one `hearthkit dev` publishes.
    for (const optionalPackageName of mailReadingOptionalPackageNames) {
      const { flowSpecPath } = appTemplateSectionsByOptionalPackage[optionalPackageName]
      const flowSpecText = readTemplateFileText(flowSpecPath)

      expect(
        flowSpecText,
        `${flowSpecPath} must take Mailpit's address from the environment`,
      ).toContain('MAILPIT_API_BASE_URL')
      expect(flowSpecText, `${flowSpecPath} must scope every read to its own recipient`).toContain(
        '/api/v1/search',
      )
      expect(flowSpecText).toContain('to:')

      // A removing request exists on both /api/v1/messages and /api/v1/search and both wipe more
      // than this run's mail, so the rule is that a flow never issues one. Matched on the HTTP verb
      // as it would be written rather than on the word, so prose explaining the rule is still free
      // to name it.
      for (const removingRequestForm of [
        /method:\s*['"]delete['"]/i,
        /['"]DELETE['"]/,
        /\.delete\(/,
      ]) {
        expect(
          flowSpecText,
          `${flowSpecPath} must issue no removing request to ${mailpitDeletingEndpoints.join(' or ')}`,
        ).not.toMatch(removingRequestForm)
      }
    }
  })

  it('proves checkout without automating Stripe hosted UI and skips itself when STRIPE_SECRET_KEY is absent', () => {
    const { flowSpecPath } = appTemplateSectionsByOptionalPackage['@hearthkit/payments']
    const paymentsFlowText = readTemplateFileText(flowSpecPath)

    // The redirect half: the URL Stripe sent the browser to, carrying the session createCheckoutSession
    // returned. Then the webhook half, signed locally, which is the same transition @hearthkit/payments'
    // own gates already prove.
    expect(paymentsFlowText).toContain('checkout.stripe.com')
    expect(paymentsFlowText).toContain('checkout.session.completed')
    expect(paymentsFlowText).toContain('/api/payments/webhook')

    // Stripe's hosted page is a third-party UI this project does not control and that changes
    // without notice. Filling it means driving Stripe's iframes, which is what frameLocator is for.
    expect(paymentsFlowText).not.toContain('frameLocator')

    // A skipped gate is not a passing gate: docs/STATUS.md records `37 passed | 8 skipped` as a
    // green exit that had not exercised Stripe at all. The tag is required so the count can be read.
    expect(paymentsFlowText).toContain('STRIPE_SECRET_KEY')
    expect(paymentsFlowText).toMatch(/test\.skip\(/)
  })
})
