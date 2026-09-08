import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The template side of every gate: where templates/app is, what it holds, and the section manifest
 * both create and these gates read.
 *
 * The manifest arrives by relative path into `templates/app/src/app-template-contract.ts`, which is
 * how `materialize-app-template-project.ts` reads it today and the only way it can be read from
 * here: `@hearthkit/app-template` is private, carries no `exports` field, and is never published, so
 * it cannot be a dependency of `@hearthkit/create`. Every value is re-exported BY NAME rather than
 * with `export *`, so a search for the name lands on this file.
 *
 * The marker scan below is a second implementation of the block rules, not a call into the pruner.
 * The malformed-marker gate hands synthetic text to `pruneOptionalSectionBlocks` and asserts it
 * refuses; the on-disk gate needs to say WHERE in which file a marker went wrong, which a function
 * that throws one message cannot answer.
 */

export {
  appContainerDefaultPort,
  appGeneratedProjectGuaranteedPaths,
  appHealthRoutePath,
  appMailpitApiBaseUrlEnvVariableName,
  appSmokeBaseUrlEnvVariableName,
  appStartupLogMessage,
  appTemplateBlockMarkerProblemSchema,
  appTemplateEnvVariableNames,
  appTemplateFailureSchema,
  appTemplateNeverCopiedDirectoryNames,
  appTemplateOptionalBlockCopiedErrorPrefix,
  appTemplateOptionalBlockMalformedErrorPrefix,
  appTemplateOptionalPackageNames,
  appTemplateOptionalSectionCopiedErrorPrefix,
  appTemplatePruneDecisionSchema,
  appTemplateRelativePathSchema,
  appTemplateRenamedPaths,
  appTemplateRepoOnlyDirectoryNames,
  appTemplateRepoOnlyPaths,
  appTemplateRequiredPackageNames,
  appTemplateSectionBlockBeginPrefix,
  appTemplateSectionBlockEndPrefix,
  appTemplateSectionsByOptionalPackage,
  appTemplateVerifyContainerScriptPath,
  appTemplateWorkspaceDependencySpecifier,
} from '../../../templates/app/src/app-template-contract.ts'

export type {
  AppTemplateBlockMarkerProblem,
  AppTemplateOptionalPackageName,
  AppTemplatePruneDecision,
  DecideTemplatePathPrune,
  PruneOptionalSectionBlocks,
} from '../../../templates/app/src/app-template-contract.ts'

import {
  appTemplateOptionalPackageNames,
  appTemplateRenamedPaths,
  appTemplateSectionBlockBeginPrefix,
  appTemplateSectionBlockEndPrefix,
  appTemplateSectionsByOptionalPackage,
  type AppTemplateOptionalPackageName,
} from '../../../templates/app/src/app-template-contract.ts'

/** Absolute path of templates/app, the live template every gate scaffolds from through templateDirectoryPath. */
export const appTemplateDirectoryPath = fileURLToPath(
  new URL('../../../templates/app', import.meta.url),
)

/** Absolute path of the hearthkit workspace root, where the packages a scaffold gate packs live. */
export const hearthkitWorkspaceRootPath = fileURLToPath(new URL('../../..', import.meta.url))

/** Text of a file in templates/app; throws naming the path so a missing template file reads as itself. */
export function readTemplateFileText(templateRelativePath: string): string {
  try {
    return readFileSync(join(appTemplateDirectoryPath, ...templateRelativePath.split('/')), 'utf8')
  } catch (error) {
    throw new Error(
      `gate could not read templates/app/${templateRelativePath}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
}

/**
 * Every file git tracks under templates/app, as sorted POSIX relative paths.
 *
 * Tracked files rather than a directory walk: `next-env.d.ts` and `tsconfig.tsbuildinfo` appear in
 * the working tree the moment anyone typechecks the template and are named in no contract list, so a
 * walk would make an exact-tree assertion pass or fail on which command someone ran last.
 */
export function trackedTemplateFilePaths(): string[] {
  let trackedOutput: string
  try {
    trackedOutput = execFileSync('git', ['ls-files', '-z'], {
      cwd: appTemplateDirectoryPath,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    })
  } catch (error) {
    throw new Error(
      `gate could not list the git-tracked files of templates/app: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
  const trackedPaths = trackedOutput.split('\0').filter((entry) => entry !== '')
  if (trackedPaths.length === 0) {
    throw new Error('gate expected git to track at least one file under templates/app')
  }
  return trackedPaths.toSorted()
}

/** The name a template file is written under in a generated project; only the ignore file changes. */
export function generatedProjectPathOf(templateRelativePath: string): string {
  return (
    appTemplateRenamedPaths.find((rename) => rename.templatePath === templateRelativePath)
      ?.generatedProjectPath ?? templateRelativePath
  )
}

/** Every path any optional package owns, paired with the package that owns it. */
export const ownedTemplatePathEntries = appTemplateOptionalPackageNames.flatMap(
  (optionalPackageName) =>
    appTemplateSectionsByOptionalPackage[optionalPackageName].ownedTemplatePaths.map(
      (ownedTemplatePath) => ({ optionalPackageName, ownedTemplatePath }),
    ),
)

/** Every file any package holds a marked block in, with the packages that hold blocks in it. */
export function packagesByBlockPrunedPath(): Map<string, AppTemplateOptionalPackageName[]> {
  const byPath = new Map<string, AppTemplateOptionalPackageName[]>()
  for (const optionalPackageName of appTemplateOptionalPackageNames) {
    for (const blockPrunedPath of appTemplateSectionsByOptionalPackage[optionalPackageName]
      .blockPrunedPaths) {
      byPath.set(blockPrunedPath, [...(byPath.get(blockPrunedPath) ?? []), optionalPackageName])
    }
  }
  return byPath
}

/**
 * Every variable name an env file documents, whether the line is commented out or live. Marker lines
 * cannot match: a section marker carries no `=` and its package name is lowercase.
 */
export function documentedEnvVariableNamesIn(envFileText: string): string[] {
  return [
    ...new Set(
      [...envFileText.matchAll(/^\s*#?\s*([A-Z][A-Z0-9_]*)\s*=/gm)]
        .map((match) => match[1])
        .filter((variableName): variableName is string => variableName !== undefined),
    ),
  ]
}

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

const escapeForRegExp = (literal: string): string =>
  literal.replaceAll(/[.*+?^${}()|[\]\\/]/g, '\\$&')

/**
 * True when this line carries this exact marker.
 *
 * The trailing guard is the anchor-string trap this repo has already paid for once: a bare
 * `includes` of `hearthkit-section:begin @hearthkit/auth` also matches `@hearthkit/auth-preview`.
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
export function sectionMarkerLinesIn(fileText: string): SectionMarkerLine[] {
  const markerLines: SectionMarkerLine[] = []

  fileText.split('\n').forEach((line, lineIndex) => {
    for (const optionalPackageName of appTemplateOptionalPackageNames) {
      for (const [markerKind, markerPrefix] of [
        ['begin', appTemplateSectionBlockBeginPrefix],
        ['end', appTemplateSectionBlockEndPrefix],
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
 * Reads a file's markers under the contract's four rules: at most one block open at any line, a
 * begin for a package that already has one open is a duplicate, an end with nothing open is
 * orphaned, and a block still open at the end of the file never closed.
 */
export function scanSectionMarkers(fileText: string): SectionMarkerScan {
  const markerLines = sectionMarkerLinesIn(fileText)
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
          ? `duplicate-block-for-package at line ${String(markerLine.lineNumber)} for ${markerLine.owningOptionalPackageName}`
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

/** Text carrying one marked block, built for the synthetic-text gates so no file on disk is involved. */
export function syntheticSectionBlockText(options: {
  owningOptionalPackageName: string
  blockLines: readonly string[]
  commentLeader?: string
}): string {
  const leader = options.commentLeader ?? '// '
  return [
    `${leader}${appTemplateSectionBlockBeginPrefix} ${options.owningOptionalPackageName}`,
    ...options.blockLines,
    `${leader}${appTemplateSectionBlockEndPrefix} ${options.owningOptionalPackageName}`,
    '',
  ].join('\n')
}
