import {
  defaultAppTemplateSectionManifest,
  type AppTemplateSectionManifest,
} from './app-template-section-manifest.ts'

/**
 * The second unit of pruning: the marked block.
 *
 * A whole file cannot be the unit everywhere. `app-runtime-config.ts` composes its env fragments from
 * named imports, so selecting a package means adding an import to a file every project keeps. This
 * deletes between balanced markers and does nothing else — no value is rewritten, no identifier
 * substituted, no placeholder filled.
 *
 * An ABSENT selection returns the text unchanged, markers and all, because that call describes the
 * template itself and the template must keep its markers to stay prunable. An EXPLICIT selection —
 * empty, partial, or naming every package — deletes each unselected package's block whole and strips
 * the begin and end lines of each kept block. So "no marker survives" is a property of a generated
 * project, never of the template.
 */

/** Options for pruneOptionalSectionBlocks; templateSectionManifest is how a scaffold run passes the manifest of the template it is copying rather than the default one. */
export type PruneOptionalSectionBlocksOptions = {
  fileText: string
  selectedOptionalPackageNames?: readonly string[]
  templateSectionManifest?: AppTemplateSectionManifest
}

/** Where one marker line sits and what it claims; line numbers are 1-based so a message reads like an editor. */
type SectionMarkerLine = {
  lineNumber: number
  markerKind: 'begin' | 'end'
  owningOptionalPackageName: string
}

/** One balanced block: the package that owns it and the inclusive line range its markers delimit. */
type SectionBlockSpan = {
  owningOptionalPackageName: string
  beginLineNumber: number
  endLineNumber: number
}

/** The begin and end matcher of every optional package, built once per manifest rather than once per line. */
type SectionMarkerPatterns = Map<string, { begin: RegExp; end: RegExp }>

const escapeForRegExp = (literal: string): string =>
  literal.replaceAll(/[.*+?^${}()|[\]\\/]/g, '\\$&')

// The trailing guard is the anchor-string trap this repo has already paid for once: a bare `includes`
// of `hearthkit-section:begin @hearthkit/auth` also matches `@hearthkit/auth-preview`, exactly as
// `'19000:9000'.includes('9000:9000')` matched and corrupted a compose file. The rule is that a marker
// line CONTAINS the prefix, one space and the EXACT package name, so the name has to end where the
// manifest says it ends.
const markerPatternsByManifest = new WeakMap<AppTemplateSectionManifest, SectionMarkerPatterns>()

/** Matchers for one manifest's package names, cached because every copied file asks for them. */
function markerPatternsOf(manifest: AppTemplateSectionManifest): SectionMarkerPatterns {
  const cached = markerPatternsByManifest.get(manifest)
  if (cached !== undefined) {
    return cached
  }
  const markerPatterns: SectionMarkerPatterns = new Map(
    manifest.appTemplateOptionalPackageNames.map((optionalPackageName) => [
      optionalPackageName,
      {
        begin: new RegExp(
          `${escapeForRegExp(manifest.appTemplateSectionBlockBeginPrefix)}[ \\t]+${escapeForRegExp(optionalPackageName)}(?![\\w./@-])`,
        ),
        end: new RegExp(
          `${escapeForRegExp(manifest.appTemplateSectionBlockEndPrefix)}[ \\t]+${escapeForRegExp(optionalPackageName)}(?![\\w./@-])`,
        ),
      },
    ]),
  )
  markerPatternsByManifest.set(manifest, markerPatterns)
  return markerPatterns
}

/** Every marker line in file order, whichever package owns it. */
function sectionMarkerLinesIn(
  fileLines: readonly string[],
  markerPatterns: SectionMarkerPatterns,
): SectionMarkerLine[] {
  const markerLines: SectionMarkerLine[] = []

  fileLines.forEach((line, lineIndex) => {
    for (const [optionalPackageName, patterns] of markerPatterns) {
      if (patterns.begin.test(line)) {
        markerLines.push({
          lineNumber: lineIndex + 1,
          markerKind: 'begin',
          owningOptionalPackageName: optionalPackageName,
        })
      }
      if (patterns.end.test(line)) {
        markerLines.push({
          lineNumber: lineIndex + 1,
          markerKind: 'end',
          owningOptionalPackageName: optionalPackageName,
        })
      }
    }
  })

  return markerLines
}

// PRECEDENCE, because two of the four overlap and a message names exactly one. A package may hold more
// than one block in a file, so a duplicate cannot mean a second block anywhere in the file — it can
// only mean a second BEGIN while that same package's block is still open, which is also a begin inside
// an open block. The tie is broken by whose block is open.
/** Refuses the text with the template's own prefix and exactly one blockMarkerProblem, which is the first one in file order. */
function refuseMalformedBlock(malformedErrorPrefix: string, markerProblem: string): never {
  throw new Error(`${malformedErrorPrefix} ${markerProblem}`)
}

/** Reads the markers under the four rules, refusing at the first problem so one message names one problem. */
function readSectionBlockSpans(
  fileLines: readonly string[],
  manifest: AppTemplateSectionManifest,
): SectionBlockSpan[] {
  const blockSpans: SectionBlockSpan[] = []
  let openMarker: SectionMarkerLine | undefined

  const malformedErrorPrefix = manifest.appTemplateOptionalBlockMalformedErrorPrefix

  for (const markerLine of sectionMarkerLinesIn(fileLines, markerPatternsOf(manifest))) {
    if (markerLine.markerKind === 'begin') {
      if (openMarker === undefined) {
        openMarker = markerLine
        continue
      }
      refuseMalformedBlock(
        malformedErrorPrefix,
        openMarker.owningOptionalPackageName === markerLine.owningOptionalPackageName
          ? `duplicate-block-for-package at line ${String(markerLine.lineNumber)} for ${markerLine.owningOptionalPackageName}, whose block opened at line ${String(openMarker.lineNumber)} is still open`
          : `begin-inside-open-block at line ${String(markerLine.lineNumber)} for ${markerLine.owningOptionalPackageName}, inside the block ${openMarker.owningOptionalPackageName} opened at line ${String(openMarker.lineNumber)}`,
      )
    }

    if (openMarker === undefined) {
      refuseMalformedBlock(
        malformedErrorPrefix,
        `end-without-begin at line ${String(markerLine.lineNumber)} for ${markerLine.owningOptionalPackageName}`,
      )
    }
    if (openMarker.owningOptionalPackageName !== markerLine.owningOptionalPackageName) {
      refuseMalformedBlock(
        malformedErrorPrefix,
        `end-without-begin at line ${String(markerLine.lineNumber)} for ${markerLine.owningOptionalPackageName}, which closes a block ${openMarker.owningOptionalPackageName} opened at line ${String(openMarker.lineNumber)}`,
      )
    }

    blockSpans.push({
      owningOptionalPackageName: markerLine.owningOptionalPackageName,
      beginLineNumber: openMarker.lineNumber,
      endLineNumber: markerLine.lineNumber,
    })
    openMarker = undefined
  }

  if (openMarker !== undefined) {
    refuseMalformedBlock(
      malformedErrorPrefix,
      `begin-without-end at line ${String(openMarker.lineNumber)} for ${openMarker.owningOptionalPackageName}`,
    )
  }

  return blockSpans
}

/**
 * Line indices a removed block takes with it: its begin line through its end line inclusive, plus the
 * blank lines immediately after the end marker.
 *
 * The trailing-blank rule is what makes the result independent of which subset was removed: every
 * block is written with exactly one blank line after its end marker, so removing any combination
 * leaves one blank line between what remains. The last array element is never taken, because a file
 * ending in a newline splits into a final empty string that is the newline rather than a blank line,
 * and consuming it would silently strip the file's last newline.
 */
function removedLineIndicesOf(fileLines: readonly string[], blockSpan: SectionBlockSpan): number[] {
  const removedLineIndices: number[] = []
  for (
    let lineIndex = blockSpan.beginLineNumber - 1;
    lineIndex < blockSpan.endLineNumber;
    lineIndex += 1
  ) {
    removedLineIndices.push(lineIndex)
  }
  for (
    let lineIndex = blockSpan.endLineNumber;
    lineIndex < fileLines.length - 1 && (fileLines[lineIndex] ?? '').trim() === '';
    lineIndex += 1
  ) {
    removedLineIndices.push(lineIndex)
  }
  return removedLineIndices
}

/** Prunes one file's marked blocks for a selection; throws with the template's own prefix when the markers are wrong. */
export function pruneOptionalSectionBlocks(options: PruneOptionalSectionBlocksOptions): string {
  const manifest = options.templateSectionManifest ?? defaultAppTemplateSectionManifest
  const fileLines = options.fileText.split('\n')
  const blockSpans = readSectionBlockSpans(fileLines, manifest)

  // Absent means the superset: this call describes the template itself, which keeps every marker so
  // that a later scaffold can still find the blocks.
  if (options.selectedOptionalPackageNames === undefined) {
    return options.fileText
  }

  const selectedOptionalPackageNames = options.selectedOptionalPackageNames
  const droppedLineIndices = new Set<number>()
  for (const blockSpan of blockSpans) {
    if (selectedOptionalPackageNames.includes(blockSpan.owningOptionalPackageName)) {
      // A kept block loses only its markers, so a generated project carries no marker text at all.
      droppedLineIndices.add(blockSpan.beginLineNumber - 1)
      droppedLineIndices.add(blockSpan.endLineNumber - 1)
      continue
    }
    for (const removedLineIndex of removedLineIndicesOf(fileLines, blockSpan)) {
      droppedLineIndices.add(removedLineIndex)
    }
  }

  return fileLines.filter((_line, lineIndex) => !droppedLineIndices.has(lineIndex)).join('\n')
}
