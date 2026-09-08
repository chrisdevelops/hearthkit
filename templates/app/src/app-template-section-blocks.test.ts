import { describe, expect, it } from 'vitest'
import { messageOfThrownFrom } from '../test-fixtures/app-template-gate-expectations.ts'
import { loadAppTemplatePruneEntry } from '../test-fixtures/app-template-prune-entry.ts'
import {
  scanSectionMarkers,
  sectionMarkerLinesIn,
  syntheticSectionBlockText,
} from '../test-fixtures/app-template-section-markers.ts'
import { readTemplateFileText } from '../test-fixtures/app-template-tree-files.ts'
import {
  appTemplateBlockMarkerProblemSchema,
  appTemplateFailureSchema,
  appTemplateOptionalBlockMalformedErrorPrefix,
  appTemplateOptionalPackageNames,
  appTemplateSectionBlockBeginPrefix,
  appTemplateSectionBlockEndPrefix,
  appTemplateSectionsByOptionalPackage,
  type AppTemplateBlockMarkerProblem,
  type AppTemplateOptionalPackageName,
} from './app-template-contract.ts'

/**
 * The block is the second unit of pruning, and app-runtime-config.ts is the file to test hardest: a
 * mis-delimited block there deletes an import and breaks the build, or deletes an import and leaves a
 * use of it. A mis-delimited block in .env.example only breaks boot, with a message from
 * @hearthkit/config naming the variable. The malformed-marker gates are what stop the loose
 * "a line CONTAINS the marker" rule from silently swallowing lines.
 */

/** Everything a marker scan needs from the contract, in one object the fixture takes. */
const markerScanValues = {
  beginPrefix: appTemplateSectionBlockBeginPrefix,
  endPrefix: appTemplateSectionBlockEndPrefix,
  optionalPackageNames: [...appTemplateOptionalPackageNames],
} as const

/** Every file any package holds a block in, deduplicated, with the packages that hold blocks in it. */
const packagesByBlockPrunedPath = new Map<string, AppTemplateOptionalPackageName[]>()
for (const optionalPackageName of appTemplateOptionalPackageNames) {
  for (const blockPrunedPath of appTemplateSectionsByOptionalPackage[optionalPackageName]
    .blockPrunedPaths) {
    packagesByBlockPrunedPath.set(blockPrunedPath, [
      ...(packagesByBlockPrunedPath.get(blockPrunedPath) ?? []),
      optionalPackageName,
    ])
  }
}

/** A line of block body carrying no marker text, so a scan of the result cannot mistake it for one. */
const storageBlockBodyLine = "import { storageEnvSchemaFragment } from '@hearthkit/storage'"
const emailBlockBodyLine = "import { emailEnvSchemaFragment } from '@hearthkit/email'"

/** Synthetic text with one block per package, one blank line after each, and always-on lines around them. */
function syntheticSupersetFileText(): string {
  return [
    "import { configEnvSchemaFragment } from '@hearthkit/config'",
    '',
    syntheticSectionBlockText({
      ...markerScanValues,
      owningOptionalPackageName: '@hearthkit/storage',
      blockLines: [storageBlockBodyLine],
    }),
    syntheticSectionBlockText({
      ...markerScanValues,
      owningOptionalPackageName: '@hearthkit/email',
      blockLines: [emailBlockBodyLine],
    }),
    'export const appEnvSchemaFragments = [configEnvSchemaFragment]',
    '',
  ].join('\n')
}

/** The one problem a message names; a malformed block carries exactly one blockMarkerProblem. */
function blockMarkerProblemsNamedIn(message: string): AppTemplateBlockMarkerProblem[] {
  return appTemplateBlockMarkerProblemSchema.options.filter((blockMarkerProblem) =>
    message.includes(blockMarkerProblem),
  )
}

/**
 * Runs pruneOptionalSectionBlocks over text whose markers are wrong and asserts it refused with the
 * contract's prefix and exactly one of the four blockMarkerProblem values.
 *
 * Exactly one, not at least one: the failure carries a single blockMarkerProblem, so a message
 * naming several would leave a caller unable to say which rule broke. Reporting the FIRST problem in
 * file order and stopping is what satisfies that for all four texts below.
 *
 * CONTRACT.md does not say which of begin-inside-open-block and duplicate-block-for-package applies
 * when a second begin arrives for the package whose block is already open, and both descriptions fit.
 * These gates settle it the only way that leaves all four values reachable and disjoint: a nested
 * begin for a DIFFERENT package is begin-inside-open-block, and one for the SAME package is
 * duplicate-block-for-package. Reported to the orchestrator as a contract gap rather than left
 * implicit here.
 */
async function expectMalformedBlock(
  malformedFileText: string,
  expectedProblem: AppTemplateBlockMarkerProblem,
): Promise<void> {
  const { pruneOptionalSectionBlocks } = await loadAppTemplatePruneEntry(
    () => import('./materialize-app-template-project.ts'),
  )

  const message = messageOfThrownFrom(() =>
    pruneOptionalSectionBlocks({ fileText: malformedFileText, selectedOptionalPackageNames: [] }),
  )

  expect(message.startsWith(appTemplateOptionalBlockMalformedErrorPrefix)).toBe(true)
  expect(blockMarkerProblemsNamedIn(message)).toEqual([expectedProblem])

  const malformedFailure = appTemplateFailureSchema.parse({
    kind: 'app-template-optional-block-malformed',
    blockPrunedPath: 'app-runtime-config.ts',
    blockMarkerProblem: expectedProblem,
    owningOptionalPackageName: '@hearthkit/storage',
    message,
  })
  expect(malformedFailure.kind).toBe('app-template-optional-block-malformed')
}

describe('the marked blocks templates/app ships', () => {
  it('balances every marker in every block-pruned file, with at most one block open at a line', () => {
    const filesWithBrokenMarkers: string[] = []

    for (const blockPrunedPath of [...packagesByBlockPrunedPath.keys()].toSorted()) {
      const { markerProblems, markerLines } = scanSectionMarkers({
        ...markerScanValues,
        fileText: readTemplateFileText(blockPrunedPath),
      })

      // A file listed as block-pruned with no marker at all is the silent half of this failure: the
      // pruner would leave whatever should have been removed exactly where it is.
      if (markerLines.length === 0) {
        filesWithBrokenMarkers.push(`${blockPrunedPath}: no section marker at all`)
      }
      for (const markerProblem of markerProblems) {
        filesWithBrokenMarkers.push(`${blockPrunedPath}: ${markerProblem}`)
      }
    }

    expect(filesWithBrokenMarkers).toEqual([])
  })

  it('holds at least one block for every package in each blockPrunedPath that package declares', () => {
    const missingBlocks: string[] = []

    for (const [blockPrunedPath, owningPackageNames] of packagesByBlockPrunedPath) {
      const { blockSpans } = scanSectionMarkers({
        ...markerScanValues,
        fileText: readTemplateFileText(blockPrunedPath),
      })

      for (const owningPackageName of owningPackageNames) {
        if (!blockSpans.some((span) => span.owningOptionalPackageName === owningPackageName)) {
          missingBlocks.push(`${blockPrunedPath} carries no block for ${owningPackageName}`)
        }
      }

      // A package holding a block in a file it never declared is the same drift from the other
      // side: @hearthkit/create prunes from blockPrunedPaths, so a block in an undeclared file is
      // one nothing ever removes.
      for (const span of blockSpans) {
        if (
          !owningPackageNames.some(
            (owningPackageName) => owningPackageName === span.owningOptionalPackageName,
          )
        ) {
          missingBlocks.push(
            `${blockPrunedPath} line ${String(span.beginLineNumber)} opens a block for ${span.owningOptionalPackageName}, which does not declare that file in blockPrunedPaths`,
          )
        }
      }
    }

    expect(missingBlocks).toEqual([])
  })
})

describe('pruneOptionalSectionBlocks', () => {
  it('keeps every block when the selection is absent and removes every block when it is empty, which are never the same answer', async () => {
    const { pruneOptionalSectionBlocks } = await loadAppTemplatePruneEntry(
      () => import('./materialize-app-template-project.ts'),
    )
    const supersetFileText = syntheticSupersetFileText()

    // Absent means the superset: nothing is pruned for being optional, which is what
    // verify:container's own call site relied on before selections existed.
    const supersetResult = pruneOptionalSectionBlocks({ fileText: supersetFileText })
    expect(supersetResult).toContain(storageBlockBodyLine)
    expect(supersetResult).toContain(emailBlockBodyLine)

    // Empty means no optional package at all. Both block bodies go, and with them every marker.
    const emptySelectionResult = pruneOptionalSectionBlocks({
      fileText: supersetFileText,
      selectedOptionalPackageNames: [],
    })
    expect(emptySelectionResult).not.toContain(storageBlockBodyLine)
    expect(emptySelectionResult).not.toContain(emailBlockBodyLine)
    expect(emptySelectionResult).not.toContain(appTemplateSectionBlockBeginPrefix)
    expect(emptySelectionResult).not.toContain(appTemplateSectionBlockEndPrefix)
    expect(emptySelectionResult).not.toBe(supersetResult)

    // A partial selection keeps exactly the blocks it names.
    const storageOnlyResult = pruneOptionalSectionBlocks({
      fileText: supersetFileText,
      selectedOptionalPackageNames: ['@hearthkit/storage'],
    })
    expect(storageOnlyResult).toContain(storageBlockBodyLine)
    expect(storageOnlyResult).not.toContain(emailBlockBodyLine)
    expect(
      sectionMarkerLinesIn({ ...markerScanValues, fileText: storageOnlyResult }).filter(
        (markerLine) => markerLine.owningOptionalPackageName === '@hearthkit/email',
      ),
    ).toEqual([])
  })

  it('returns everything outside a removed block byte for byte, leaving one blank line where the block was', async () => {
    const { pruneOptionalSectionBlocks } = await loadAppTemplatePruneEntry(
      () => import('./materialize-app-template-project.ts'),
    )

    // The trailing-blank rule is what makes the result independent of WHICH subset was removed: each
    // block is written with exactly one blank line after its end marker, so removing any combination
    // leaves one blank line between what remains, and removing all of them returns the file to the
    // state it was in before any block existed. Byte for byte, not "looks right": a stray blank line
    // per pruned block is exactly the drift a contains-check would never see.
    const bothRemoved = pruneOptionalSectionBlocks({
      fileText: syntheticSupersetFileText(),
      selectedOptionalPackageNames: [],
    })

    expect(bothRemoved).toBe(
      [
        "import { configEnvSchemaFragment } from '@hearthkit/config'",
        '',
        'export const appEnvSchemaFragments = [configEnvSchemaFragment]',
        '',
      ].join('\n'),
    )
  })

  it('refuses a begin marker with no end, which would otherwise delete the rest of the file', async () => {
    await expectMalformedBlock(
      [
        "import { configEnvSchemaFragment } from '@hearthkit/config'",
        `// ${appTemplateSectionBlockBeginPrefix} @hearthkit/storage`,
        storageBlockBodyLine,
        '',
        'export const appEnvSchemaFragments = [configEnvSchemaFragment]',
        '',
      ].join('\n'),
      'begin-without-end',
    )
  })

  it('refuses an end marker with no begin, which names a block that was never opened', async () => {
    await expectMalformedBlock(
      [
        "import { configEnvSchemaFragment } from '@hearthkit/config'",
        storageBlockBodyLine,
        `// ${appTemplateSectionBlockEndPrefix} @hearthkit/storage`,
        '',
      ].join('\n'),
      'end-without-begin',
    )
  })

  it('refuses one package block opened inside another, because blocks never nest and never overlap', async () => {
    await expectMalformedBlock(
      [
        `// ${appTemplateSectionBlockBeginPrefix} @hearthkit/storage`,
        storageBlockBodyLine,
        `// ${appTemplateSectionBlockBeginPrefix} @hearthkit/email`,
        emailBlockBodyLine,
        `// ${appTemplateSectionBlockEndPrefix} @hearthkit/email`,
        `// ${appTemplateSectionBlockEndPrefix} @hearthkit/storage`,
        '',
      ].join('\n'),
      'begin-inside-open-block',
    )
  })

  it('refuses a second begin for a package whose block is already open, which no second block in the same file may look like', async () => {
    // A package may legitimately hold MORE THAN ONE block in the same file — an import statement and
    // an array entry are two regions of app-runtime-config.ts. So a duplicate is only ever a second
    // begin for a package while its first is still open; two closed blocks for one package are fine
    // and the byte-for-byte gate above depends on that staying true.
    await expectMalformedBlock(
      [
        `// ${appTemplateSectionBlockBeginPrefix} @hearthkit/storage`,
        storageBlockBodyLine,
        `// ${appTemplateSectionBlockBeginPrefix} @hearthkit/storage`,
        storageBlockBodyLine,
        `// ${appTemplateSectionBlockEndPrefix} @hearthkit/storage`,
        '',
      ].join('\n'),
      'duplicate-block-for-package',
    )
  })
})
