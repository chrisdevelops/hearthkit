import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  expectExportedFunction,
  importTemplateModule,
} from '../test-fixtures/app-template-gate-expectations.ts'
import {
  gateSupersetEnv,
  reserveDeadLoopbackPort,
} from '../test-fixtures/app-template-gate-environment.ts'
import { scanSectionMarkers } from '../test-fixtures/app-template-section-markers.ts'
import {
  importSpecifiersInText,
  readTemplateFileText,
  resolveTemplateRelativeSpecifier,
  trackedTemplateFilePaths,
} from '../test-fixtures/app-template-tree-files.ts'
import {
  appSectionRouteFailedErrorPrefix,
  appTemplateFailureSchema,
  appTemplateOptionalPackageNames,
  appTemplateSectionBlockBeginPrefix,
  appTemplateSectionBlockEndPrefix,
  appTemplateSectionDynamicMode,
  appTemplateSectionsByOptionalPackage,
  appTemplateSupersetEnvVariableNames,
  type AppTemplateOptionalPackageName,
} from './app-template-contract.ts'

/**
 * What the sections must be as files, plus the one gate that proves a section surfaces its package's
 * failure instead of swallowing it. Everything here is either text or a route handler called
 * directly, so the fast tier stays free of services; the flows are what exercise the sections for
 * real.
 */

/** A route handler as Next calls it: a Web Request in, a Web Response out. */
type SectionRouteHandler = (request: Request) => Promise<Response>

/** Section files that must carry the route segment config: pages and route handlers, not the plain modules beside them. */
const isSectionRouteFile = (ownedTemplatePath: string): boolean =>
  ownedTemplatePath.startsWith('app/') &&
  (ownedTemplatePath.endsWith('/page.tsx') || ownedTemplatePath.endsWith('/route.ts'))

/** The exact line every section page and route handler carries, spelled as the contract's constant. */
const sectionDynamicExportLine = `export const dynamic = '${appTemplateSectionDynamicMode}'`

/** Where the email section's route handler lives, and the one field this gate posts to it. */
const emailTestMessageRoutePath = 'app/api/email/test-message/route.ts'

/** Which package owns each owned path, for the import invariant. */
const owningPackageByTemplatePath = new Map<string, AppTemplateOptionalPackageName>()
for (const optionalPackageName of appTemplateOptionalPackageNames) {
  for (const ownedTemplatePath of appTemplateSectionsByOptionalPackage[optionalPackageName]
    .ownedTemplatePaths) {
    owningPackageByTemplatePath.set(ownedTemplatePath, optionalPackageName)
  }
}

/**
 * Every package a selection carrying this one must also carry, transitively. A file @hearthkit/auth
 * owns may reach @hearthkit/email, because auth requires email and no selection can separate them;
 * that is the whole reason requiredOptionalPackageNames exists.
 */
function requiredOptionalPackageClosureOf(
  optionalPackageName: AppTemplateOptionalPackageName,
): Set<AppTemplateOptionalPackageName> {
  const closure = new Set<AppTemplateOptionalPackageName>([optionalPackageName])
  const pending = [optionalPackageName]
  while (pending.length > 0) {
    const nextPackageName = pending.pop()
    if (nextPackageName === undefined) {
      break
    }
    for (const requiredName of appTemplateSectionsByOptionalPackage[nextPackageName]
      .requiredOptionalPackageNames) {
      if (!closure.has(requiredName)) {
        closure.add(requiredName)
        pending.push(requiredName)
      }
    }
  }
  return closure
}

/** The package an import specifier belongs to, or undefined when it belongs to no optional package. */
function optionalPackageOfSpecifier(
  importingTemplatePath: string,
  specifier: string,
): AppTemplateOptionalPackageName | undefined {
  if (specifier.startsWith('.')) {
    return owningPackageByTemplatePath.get(
      resolveTemplateRelativeSpecifier(importingTemplatePath, specifier),
    )
  }
  return appTemplateOptionalPackageNames.find((optionalPackageName) =>
    appTemplateSectionsByOptionalPackage[optionalPackageName].hearthkitDependencyNames.some(
      (hearthkitDependencyName) =>
        specifier === hearthkitDependencyName ||
        specifier.startsWith(`${hearthkitDependencyName}/`),
    ),
  )
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('the optional package sections as files', () => {
  it('exports the force-dynamic route segment config from every section page and route handler', () => {
    // next build runs with an empty environment. A section page that built a storage connection or a
    // Drizzle client while being prerendered would fail the build with a missing-variable message.
    // Route handlers have been dynamic by default since Next 15 and carry the export anyway, so the
    // rule is one rule and this gate can check it by reading the file.
    const sectionFilesWithoutDynamicMode: string[] = []

    for (const optionalPackageName of appTemplateOptionalPackageNames) {
      for (const ownedTemplatePath of appTemplateSectionsByOptionalPackage[optionalPackageName]
        .ownedTemplatePaths) {
        if (!isSectionRouteFile(ownedTemplatePath)) {
          continue
        }
        const sectionFileText = readTemplateFileText(ownedTemplatePath)
        if (!sectionFileText.includes(sectionDynamicExportLine)) {
          sectionFilesWithoutDynamicMode.push(`${ownedTemplatePath} (${optionalPackageName})`)
        }
        // Every variable this app reads is declared by the package that owns it and composed by
        // @hearthkit/config, so a section reads config and never the environment: reaching for
        // process.env is how a value escapes the boot-time validation that names it when it is wrong.
        expect(
          sectionFileText,
          `${ownedTemplatePath} must read config rather than process.env`,
        ).not.toContain('process.env')
      }
    }

    // A package whose section has no page and no route handler would pass the loop above vacuously.
    expect(
      appTemplateOptionalPackageNames.filter(
        (optionalPackageName) =>
          !appTemplateSectionsByOptionalPackage[optionalPackageName].ownedTemplatePaths.some(
            isSectionRouteFile,
          ),
      ),
    ).toEqual([])
    expect(sectionFilesWithoutDynamicMode).toEqual([])
  })

  it('reads the raw request body in the payments webhook route and never parses it as JSON', () => {
    // handleStripeWebhook takes rawRequestBody, and the signature is computed over exactly the bytes
    // Stripe sent. `await request.json()` re-serialises them, which turns every delivery into a
    // signature mismatch that reads like a wrong secret.
    const webhookRouteText = readTemplateFileText('app/api/payments/webhook/route.ts')

    expect(webhookRouteText).toContain('request.text()')
    expect(webhookRouteText).not.toContain('request.json()')
    expect(webhookRouteText).toContain('rawRequestBody')
  })

  it('imports an optional package only from a file that package owns, a file requiring it, or inside its own marked block', () => {
    // The optional-package form of the repo-only import invariant, and what makes whole-file pruning
    // safe: a file every project keeps that imported a section would break the moment that section
    // was pruned. Covers bare package specifiers and relative imports of another section's files
    // alike, because both disappear with the same deletion.
    const importsThatWouldNotSurvivePruning: string[] = []

    for (const templateRelativePath of trackedTemplateFilePaths()) {
      if (
        !/\.(ts|tsx|mjs|cjs|js|jsx)$/.test(templateRelativePath) ||
        templateRelativePath.startsWith('src/') ||
        templateRelativePath.startsWith('test-fixtures/')
      ) {
        continue
      }

      const fileText = readTemplateFileText(templateRelativePath)
      const { blockSpans } = scanSectionMarkers({
        fileText,
        beginPrefix: appTemplateSectionBlockBeginPrefix,
        endPrefix: appTemplateSectionBlockEndPrefix,
        optionalPackageNames: [...appTemplateOptionalPackageNames],
      })
      const owningPackageOfThisFile = owningPackageByTemplatePath.get(templateRelativePath)
      const reachableWithoutABlock =
        owningPackageOfThisFile === undefined
          ? new Set<AppTemplateOptionalPackageName>()
          : requiredOptionalPackageClosureOf(owningPackageOfThisFile)

      fileText.split('\n').forEach((line, lineIndex) => {
        for (const specifier of importSpecifiersInText(line)) {
          const importedPackageName = optionalPackageOfSpecifier(templateRelativePath, specifier)
          if (
            importedPackageName === undefined ||
            reachableWithoutABlock.has(importedPackageName)
          ) {
            continue
          }
          const insideItsOwnBlock = blockSpans.some(
            (span) =>
              span.owningOptionalPackageName === importedPackageName &&
              lineIndex + 1 > span.beginLineNumber &&
              lineIndex + 1 < span.endLineNumber,
          )
          if (!insideItsOwnBlock) {
            importsThatWouldNotSurvivePruning.push(
              `${templateRelativePath} line ${String(lineIndex + 1)} imports ${specifier}, which goes with ${importedPackageName}, from a file ${owningPackageOfThisFile ?? 'every project keeps'}`,
            )
          }
        }
      })
    }

    expect(importsThatWouldNotSurvivePruning).toEqual([])

    // The positive half, and the reason blocks exist at all: app-runtime-config.ts composes
    // appEnvSchemaFragments from NAMED imports, so a selected package's fragment arrives as an
    // import inside that package's own block. Whole-file pruning cannot add or remove an import,
    // which is what makes this the file to get right. It is also what keeps the scan above from
    // passing vacuously while no section exists.
    const runtimeConfigText = readTemplateFileText('app-runtime-config.ts')
    const runtimeConfigLines = runtimeConfigText.split('\n')
    const runtimeConfigBlocks = scanSectionMarkers({
      fileText: runtimeConfigText,
      beginPrefix: appTemplateSectionBlockBeginPrefix,
      endPrefix: appTemplateSectionBlockEndPrefix,
      optionalPackageNames: [...appTemplateOptionalPackageNames],
    }).blockSpans
    const packagesWithNoFragmentImport = appTemplateOptionalPackageNames.filter(
      (optionalPackageName) =>
        !runtimeConfigBlocks.some(
          (span) =>
            span.owningOptionalPackageName === optionalPackageName &&
            runtimeConfigLines
              .slice(span.beginLineNumber, span.endLineNumber - 1)
              .some((line) =>
                appTemplateSectionsByOptionalPackage[
                  optionalPackageName
                ].hearthkitDependencyNames.some((hearthkitDependencyName) =>
                  importSpecifiersInText(line).includes(hearthkitDependencyName),
                ),
              ),
        ),
    )
    expect(packagesWithNoFragmentImport).toEqual([])

    // The home page is the file this rule exists for: sections are reached by their own route, so a
    // home page linking to one would need content rewritten rather than removed, and it carries no
    // marked block at all.
    const homePageText = readTemplateFileText('app/page.tsx')
    expect(homePageText).not.toContain(appTemplateSectionBlockBeginPrefix)
    for (const optionalPackageName of appTemplateOptionalPackageNames) {
      const sectionRoutePath =
        appTemplateSectionsByOptionalPackage[optionalPackageName].sectionRoutePath
      // Quoted on both sides, because an unquoted '/email' also matches an address in a comment.
      for (const quotedRoutePath of [`"${sectionRoutePath}"`, `'${sectionRoutePath}'`]) {
        expect(homePageText, `app/page.tsx must not link to ${optionalPackageName}`).not.toContain(
          quotedRoutePath,
        )
      }
    }
  })

  it('answers outside the 2xx range from the email section carrying @hearthkit/email own message when SMTP is unreachable', async () => {
    // The cheap producer of app-section-route-failed, and the only one that needs no extra service:
    // EMAIL_SMTP_HOST aimed at a port nothing is listening on. It proves a section surfaces the
    // owning package's failure rather than swallowing it; the other three sections are taken to
    // behave the same way by construction.
    const deadSmtpPortNumber = await reserveDeadLoopbackPort()
    const supersetEnv = gateSupersetEnv({
      supersetEnvVariableNames: appTemplateSupersetEnvVariableNames,
      optionalEnvVariableNames: appTemplateOptionalPackageNames.flatMap(
        (optionalPackageName) =>
          appTemplateSectionsByOptionalPackage[optionalPackageName].envVariableNames,
      ),
      overrides: { EMAIL_SMTP_PORT: String(deadSmtpPortNumber) },
    })
    for (const [variableName, value] of Object.entries(supersetEnv)) {
      vi.stubEnv(variableName, value)
    }

    const routeNamespace = await importTemplateModule(
      emailTestMessageRoutePath,
      () => import('../app/api/email/test-message/route.ts'),
    )
    const handleTestMessageRequest = expectExportedFunction(
      routeNamespace,
      'POST',
      emailTestMessageRoutePath,
    ) as unknown as SectionRouteHandler

    const response = await handleTestMessageRequest(
      new Request('http://127.0.0.1/api/email/test-message', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ recipientEmailAddress: 'gate-section-route@hearthkit.test' }),
      }),
    )
    const responseBodyText = await response.text()

    expect(response.status).toBeGreaterThanOrEqual(400)

    // The owning package's own message, unchanged, so its prefix stays greppable. Imported here
    // rather than at the top of the file: @hearthkit/email is not installed in templates/app until
    // the implementor declares it, and a static import would fail collection instead of this gate.
    const { emailTransportUnreachableErrorPrefix } = (await import('@hearthkit/email')) as {
      emailTransportUnreachableErrorPrefix: string
    }
    expect(responseBodyText).toContain(emailTransportUnreachableErrorPrefix)

    // Never a secret the route was configured with: this body is what an operator pastes into a
    // ticket.
    expect(responseBodyText).not.toContain(supersetEnv.STRIPE_SECRET_KEY ?? 'no stripe key stubbed')
    expect(responseBodyText).not.toContain(supersetEnv.AUTH_SECRET ?? 'no auth secret stubbed')

    const sectionRoutePath =
      appTemplateSectionsByOptionalPackage['@hearthkit/email'].sectionRoutePath
    const sectionRouteFailure = appTemplateFailureSchema.parse({
      kind: 'app-section-route-failed',
      sectionRoutePath,
      owningOptionalPackageName: '@hearthkit/email',
      observedStatusCode: response.status,
      owningPackageFailureMessage: responseBodyText,
      message: `${appSectionRouteFailedErrorPrefix} ${sectionRoutePath} answered ${String(response.status)}`,
    })
    expect(sectionRouteFailure.kind).toBe('app-section-route-failed')
  })
})
