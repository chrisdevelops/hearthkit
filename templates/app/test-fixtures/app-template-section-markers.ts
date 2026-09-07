/**
 * The gate's own reading of a file's section markers.
 *
 * This is deliberately a second implementation of the marker rules, not a call into the pruner. Two
 * different gates need two different things: the four blockMarkerProblem gates hand synthetic text to
 * `pruneOptionalSectionBlocks` and assert it refuses, while the on-disk gates need to say WHERE in
 * which file a marker went wrong — which a function that throws one message cannot answer. Nothing
 * here imports src/, in keeping with the rest of test-fixtures/: every contract value arrives as an
 * argument.
 */

/** Where one marker line sits and what it claims, with line numbers 1-based so a failure reads like an editor. */
export type SectionMarkerLine = {
  lineNumber: number
  markerKind: 'begin' | 'end'
  owningOptionalPackageName: string
}

/** One balanced block: the package that owns it and the inclusive line range its markers delimit. */
export type SectionBlockSpan = {
  owningOptionalPackageName: string
  beginLineNumber: number
  endLineNumber: number
}

/** What a file's markers came to: the balanced blocks, and one sentence per rule that was broken. */
export type SectionMarkerScan = {
  markerLines: readonly SectionMarkerLine[]
  blockSpans: readonly SectionBlockSpan[]
  markerProblems: readonly string[]
}

/** Every value a scan needs; the two prefixes and the package names are contract values the caller passes in. */
export type SectionMarkerScanOptions = {
  fileText: string
  beginPrefix: string
  endPrefix: string
  optionalPackageNames: readonly string[]
}

const escapeForRegExp = (literal: string): string =>
  literal.replaceAll(/[.*+?^${}()|[\]\\/]/g, '\\$&')

/**
 * True when this line carries this exact marker.
 *
 * The trailing guard is the anchor-string trap this repo has already paid for once: a bare `includes`
 * of `hearthkit-section:begin @hearthkit/auth` also matches a hypothetical `@hearthkit/auth-preview`,
 * exactly as `'19000:9000'.includes('9000:9000')` matched and silently corrupted a compose file. The
 * contract's rule is that a marker line CONTAINS the prefix, one space and the EXACT package name,
 * so the name has to end where the contract says it ends.
 */
function lineCarriesMarker(
  line: string,
  markerPrefix: string,
  optionalPackageName: string,
): boolean {
  return new RegExp(
    `${escapeForRegExp(markerPrefix)}[ \\t]+${escapeForRegExp(optionalPackageName)}(?![\\w./@-])`,
  ).test(line)
}

/** Every marker line in a file, in file order, whichever package owns it. */
export function sectionMarkerLinesIn(options: SectionMarkerScanOptions): SectionMarkerLine[] {
  const markerLines: SectionMarkerLine[] = []

  options.fileText.split('\n').forEach((line, lineIndex) => {
    for (const optionalPackageName of options.optionalPackageNames) {
      for (const [markerKind, markerPrefix] of [
        ['begin', options.beginPrefix],
        ['end', options.endPrefix],
      ] as const) {
        if (lineCarriesMarker(line, markerPrefix, optionalPackageName)) {
          markerLines.push({
            lineNumber: lineIndex + 1,
            markerKind,
            owningOptionalPackageName: optionalPackageName,
          })
        }
      }
    }
  })

  return markerLines
}

/**
 * Reads a file's markers under the contract's four rules: at most one block open at any line, a begin
 * for a package that already has one open is a duplicate, an end with nothing open is orphaned, and a
 * block still open at the end of the file never closed. A package may legitimately hold several
 * blocks in one file, so a duplicate is only ever a second begin while the first is still open.
 */
export function scanSectionMarkers(options: SectionMarkerScanOptions): SectionMarkerScan {
  const markerLines = sectionMarkerLinesIn(options)
  const blockSpans: SectionBlockSpan[] = []
  const markerProblems: string[] = []
  let openMarker: SectionMarkerLine | undefined

  for (const markerLine of markerLines) {
    if (markerLine.markerKind === 'begin') {
      if (openMarker === undefined) {
        openMarker = markerLine
        continue
      }
      markerProblems.push(
        openMarker.owningOptionalPackageName === markerLine.owningOptionalPackageName
          ? `duplicate-block-for-package at line ${String(markerLine.lineNumber)} for ${markerLine.owningOptionalPackageName}, whose block opened at line ${String(openMarker.lineNumber)} is still open`
          : `begin-inside-open-block at line ${String(markerLine.lineNumber)} for ${markerLine.owningOptionalPackageName}, inside the block ${openMarker.owningOptionalPackageName} opened at line ${String(openMarker.lineNumber)}`,
      )
      continue
    }

    if (openMarker === undefined) {
      markerProblems.push(
        `end-without-begin at line ${String(markerLine.lineNumber)} for ${markerLine.owningOptionalPackageName}`,
      )
      continue
    }
    if (openMarker.owningOptionalPackageName !== markerLine.owningOptionalPackageName) {
      markerProblems.push(
        `end-without-begin at line ${String(markerLine.lineNumber)} for ${markerLine.owningOptionalPackageName}, which closes a block ${openMarker.owningOptionalPackageName} opened at line ${String(openMarker.lineNumber)}`,
      )
      openMarker = undefined
      continue
    }
    blockSpans.push({
      owningOptionalPackageName: markerLine.owningOptionalPackageName,
      beginLineNumber: openMarker.lineNumber,
      endLineNumber: markerLine.lineNumber,
    })
    openMarker = undefined
  }

  if (openMarker !== undefined) {
    markerProblems.push(
      `begin-without-end at line ${String(openMarker.lineNumber)} for ${openMarker.owningOptionalPackageName}`,
    )
  }

  return { markerLines, blockSpans, markerProblems }
}

/** The lines of a file that sit inside no block at all, which for .env.example is what every project keeps. */
export function fileLinesOutsideSectionBlocks(options: SectionMarkerScanOptions): string[] {
  const { blockSpans } = scanSectionMarkers(options)
  return options.fileText
    .split('\n')
    .filter(
      (_line, lineIndex) =>
        !blockSpans.some(
          (span) => lineIndex + 1 >= span.beginLineNumber && lineIndex + 1 <= span.endLineNumber,
        ),
    )
}

/** The lines inside every block one package owns in a file, markers included. */
export function fileLinesInsideSectionBlocksOf(
  options: SectionMarkerScanOptions & { owningOptionalPackageName: string },
): string[] {
  const { blockSpans } = scanSectionMarkers(options)
  const ownedSpans = blockSpans.filter(
    (span) => span.owningOptionalPackageName === options.owningOptionalPackageName,
  )
  return options.fileText
    .split('\n')
    .filter((_line, lineIndex) =>
      ownedSpans.some(
        (span) => lineIndex + 1 >= span.beginLineNumber && lineIndex + 1 <= span.endLineNumber,
      ),
    )
}

/** Text carrying one marked block, built for the synthetic-text gates so no file on disk is involved. */
export function syntheticSectionBlockText(options: {
  beginPrefix: string
  endPrefix: string
  owningOptionalPackageName: string
  blockLines: readonly string[]
  commentLeader?: string
}): string {
  const leader = options.commentLeader ?? '// '
  return [
    `${leader}${options.beginPrefix} ${options.owningOptionalPackageName}`,
    ...options.blockLines,
    `${leader}${options.endPrefix} ${options.owningOptionalPackageName}`,
    '',
  ].join('\n')
}
