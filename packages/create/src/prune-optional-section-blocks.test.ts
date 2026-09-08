import { describe, expect, it } from 'vitest'
import {
  loadHearthkitCreateEntry,
  messageOfThrownFrom,
} from '../test-fixtures/create-gate-project-directories.ts'
import {
  appTemplateBlockMarkerProblemSchema,
  appTemplateFailureSchema,
  appTemplateOptionalBlockMalformedErrorPrefix,
  appTemplateOptionalPackageNames,
  appTemplateSectionBlockBeginPrefix,
  appTemplateSectionBlockEndPrefix,
  packagesByBlockPrunedPath,
  readTemplateFileText,
  scanSectionMarkers,
  sectionMarkerLinesIn,
  syntheticSectionBlockText,
  type AppTemplateBlockMarkerProblem,
} from '../test-fixtures/create-gate-template-manifest.ts'

/**
 * The block half of pruning, moved here with the logic it covers (completion plan 3.2).
 *
 * `app-runtime-config.ts` is the file to test hardest: a mis-delimited block there deletes an import
 * and breaks the build, or deletes an import and leaves a use of it. A mis-delimited block in
 * `.env.example` only breaks boot, with a message from @hearthkit/config naming the variable. The
 * malformed-marker gate is what stops the loose "a line CONTAINS the marker" rule from silently
 * swallowing lines.
 *
 * CONTRACT.md does not say which of begin-inside-open-block and duplicate-block-for-package applies
 * when a second begin arrives for the package whose block is already open, and both descriptions
 * fit. These gates settle it the only way that leaves all four values reachable and disjoint: a
 * nested begin for a DIFFERENT package is begin-inside-open-block, and one for the SAME package is
 * duplicate-block-for-package. Reported to the orchestrator as a contract gap rather than left
 * implicit here.
 */

/** A line of block body carrying no marker text, so a scan of the result cannot mistake it for one. */
const storageBlockBodyLine = "import { storageEnvSchemaFragment } from '@hearthkit/storage'"
const emailBlockBodyLine = "import { emailEnvSchemaFragment } from '@hearthkit/email'"

/** Synthetic text with one block per package, one blank line after each, and always-on lines around them. */
function syntheticSupersetFileText(): string {
  return [
    "import { configEnvSchemaFragment } from '@hearthkit/config'",
    '',
    syntheticSectionBlockText({
      owningOptionalPackageName: '@hearthkit/storage',
      blockLines: [storageBlockBodyLine],
    }),
    syntheticSectionBlockText({
      owningOptionalPackageName: '@hearthkit/email',
      blockLines: [emailBlockBodyLine],
    }),
    'export const appEnvSchemaFragments = [configEnvSchemaFragment]',
    '',
  ].join('\n')
}

/** The problems a message names; a malformed block carries exactly one blockMarkerProblem. */
function blockMarkerProblemsNamedIn(message: string): AppTemplateBlockMarkerProblem[] {
  return appTemplateBlockMarkerProblemSchema.options.filter((blockMarkerProblem) =>
    message.includes(blockMarkerProblem),
  )
}

describe('pruneOptionalSectionBlocks', () => {
  it('keeps the blocks the selection names, removes the rest, and returns every other line byte for byte', async () => {
    const { pruneOptionalSectionBlocks } = await loadHearthkitCreateEntry()
    const supersetFileText = syntheticSupersetFileText()

    // Absent means the superset: nothing is pruned for being optional, which is what the template
    // itself is and what verify:container's call site relied on before selections existed.
    const supersetResult = pruneOptionalSectionBlocks({ fileText: supersetFileText })
    expect(supersetResult).toContain(storageBlockBodyLine)
    expect(supersetResult).toContain(emailBlockBodyLine)

    // A partial selection keeps exactly the blocks it names, markers and all removed for the rest.
    const storageOnlyResult = pruneOptionalSectionBlocks({
      fileText: supersetFileText,
      selectedOptionalPackageNames: ['@hearthkit/storage'],
    })
    expect(storageOnlyResult).toContain(storageBlockBodyLine)
    expect(storageOnlyResult).not.toContain(emailBlockBodyLine)
    expect(
      sectionMarkerLinesIn(storageOnlyResult).filter(
        (markerLine) => markerLine.owningOptionalPackageName === '@hearthkit/email',
      ),
    ).toEqual([])

    // Empty means no optional package at all. The trailing-blank rule is what makes the result
    // independent of WHICH subset was removed: each block is written with exactly one blank line
    // after its end marker, so removing any combination leaves one blank line between what remains,
    // and removing all of them returns the file to the state it was in before any block existed.
    // Byte for byte, not "looks right": a stray blank line per pruned block is exactly the drift a
    // contains-check would never see.
    const emptySelectionResult = pruneOptionalSectionBlocks({
      fileText: supersetFileText,
      selectedOptionalPackageNames: [],
    })
    expect(emptySelectionResult).toBe(
      [
        "import { configEnvSchemaFragment } from '@hearthkit/config'",
        '',
        'export const appEnvSchemaFragments = [configEnvSchemaFragment]',
        '',
      ].join('\n'),
    )
    expect(emptySelectionResult).not.toBe(supersetResult)
  })

  it('refuses every malformed marker arrangement with the template prefix and exactly one blockMarkerProblem', async () => {
    const { pruneOptionalSectionBlocks } = await loadHearthkitCreateEntry()

    // Exactly one, not at least one: the failure carries a single blockMarkerProblem, so a message
    // naming several would leave a caller unable to say which rule broke. Reporting the FIRST
    // problem in file order and stopping is what satisfies that for all four texts.
    const malformedTexts: { expectedProblem: AppTemplateBlockMarkerProblem; fileText: string }[] = [
      {
        // A begin with no end would otherwise delete the rest of the file.
        expectedProblem: 'begin-without-end',
        fileText: [
          "import { configEnvSchemaFragment } from '@hearthkit/config'",
          `// ${appTemplateSectionBlockBeginPrefix} @hearthkit/storage`,
          storageBlockBodyLine,
          '',
          'export const appEnvSchemaFragments = [configEnvSchemaFragment]',
          '',
        ].join('\n'),
      },
      {
        // An end with no begin names a block that was never opened.
        expectedProblem: 'end-without-begin',
        fileText: [
          "import { configEnvSchemaFragment } from '@hearthkit/config'",
          storageBlockBodyLine,
          `// ${appTemplateSectionBlockEndPrefix} @hearthkit/storage`,
          '',
        ].join('\n'),
      },
      {
        // Blocks never nest and never overlap.
        expectedProblem: 'begin-inside-open-block',
        fileText: [
          `// ${appTemplateSectionBlockBeginPrefix} @hearthkit/storage`,
          storageBlockBodyLine,
          `// ${appTemplateSectionBlockBeginPrefix} @hearthkit/email`,
          emailBlockBodyLine,
          `// ${appTemplateSectionBlockEndPrefix} @hearthkit/email`,
          `// ${appTemplateSectionBlockEndPrefix} @hearthkit/storage`,
          '',
        ].join('\n'),
      },
      {
        // A package may legitimately hold more than one block in one file, so a duplicate is only
        // ever a second begin for a package while its first is still open.
        expectedProblem: 'duplicate-block-for-package',
        fileText: [
          `// ${appTemplateSectionBlockBeginPrefix} @hearthkit/storage`,
          storageBlockBodyLine,
          `// ${appTemplateSectionBlockBeginPrefix} @hearthkit/storage`,
          storageBlockBodyLine,
          `// ${appTemplateSectionBlockEndPrefix} @hearthkit/storage`,
          '',
        ].join('\n'),
      },
    ]

    for (const { expectedProblem, fileText } of malformedTexts) {
      const message = messageOfThrownFrom(() =>
        pruneOptionalSectionBlocks({ fileText, selectedOptionalPackageNames: [] }),
      )

      expect(message.startsWith(appTemplateOptionalBlockMalformedErrorPrefix), message).toBe(true)
      expect(blockMarkerProblemsNamedIn(message)).toEqual([expectedProblem])

      // A template defect, not a CreateFailure: no option a user can pass causes it, so it is
      // reported through the template's own failure union.
      expect(
        appTemplateFailureSchema.parse({
          kind: 'app-template-optional-block-malformed',
          blockPrunedPath: 'app-runtime-config.ts',
          blockMarkerProblem: expectedProblem,
          owningOptionalPackageName: '@hearthkit/storage',
          message,
        }).kind,
      ).toBe('app-template-optional-block-malformed')
    }
  })

  it('prunes every block-pruned file the template ships, under every selection, leaving no marker behind', async () => {
    const { pruneOptionalSectionBlocks } = await loadHearthkitCreateEntry()
    const filesWithBrokenMarkers: string[] = []
    const everySelection = [
      [],
      [...appTemplateOptionalPackageNames],
    ] as const satisfies readonly (readonly string[])[]

    for (const [blockPrunedPath, owningPackageNames] of [...packagesByBlockPrunedPath()].toSorted(
      ([leftPath], [rightPath]) => leftPath.localeCompare(rightPath),
    )) {
      const fileText = readTemplateFileText(blockPrunedPath)
      const { markerLines, blockSpans } = scanSectionMarkers(fileText)

      // A file listed as block-pruned with no marker at all is the silent half of this failure: the
      // pruner would leave whatever should have been removed exactly where it is.
      if (markerLines.length === 0) {
        filesWithBrokenMarkers.push(`${blockPrunedPath}: no section marker at all`)
      }
      for (const owningPackageName of owningPackageNames) {
        if (!blockSpans.some((span) => span.owningOptionalPackageName === owningPackageName)) {
          filesWithBrokenMarkers.push(
            `${blockPrunedPath} carries no block for ${owningPackageName}`,
          )
        }
      }

      // The same drift from the other side: create prunes from blockPrunedPaths, so a block in a
      // file its package never declared is one nothing ever removes.
      for (const span of blockSpans) {
        if (
          !owningPackageNames.some(
            (owningPackageName) => owningPackageName === span.owningOptionalPackageName,
          )
        ) {
          filesWithBrokenMarkers.push(
            `${blockPrunedPath} line ${String(span.beginLineNumber)} opens a block for ${span.owningOptionalPackageName}, which does not declare that file in blockPrunedPaths`,
          )
        }
      }

      // And the pruner agrees with the scan: it refuses none of these files, and a kept block loses
      // its own begin and end lines, so neither the empty selection nor the superset leaves a marker.
      for (const selectedOptionalPackageNames of everySelection) {
        let prunedFileText: string
        try {
          prunedFileText = pruneOptionalSectionBlocks({ fileText, selectedOptionalPackageNames })
        } catch (error) {
          filesWithBrokenMarkers.push(
            `${blockPrunedPath} refused for [${selectedOptionalPackageNames.join(', ')}]: ${error instanceof Error ? error.message : String(error)}`,
          )
          continue
        }
        if (
          prunedFileText.includes(appTemplateSectionBlockBeginPrefix) ||
          prunedFileText.includes(appTemplateSectionBlockEndPrefix)
        ) {
          filesWithBrokenMarkers.push(
            `${blockPrunedPath} still carries a marker after pruning for [${selectedOptionalPackageNames.join(', ')}]`,
          )
        }
      }
    }

    expect(filesWithBrokenMarkers).toEqual([])
  })
})
