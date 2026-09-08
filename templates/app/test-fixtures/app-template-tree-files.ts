import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isUnknownRecord } from './app-template-gate-expectations.ts'

/**
 * Filesystem helpers the shape gates share. Nothing here imports src/app-template-contract.ts: this
 * directory sits outside src/, so importing the contract from it would break the very invariant the
 * tree gate checks. Every contract value a gate needs is passed in by the gate instead.
 */

/** Absolute path of templates/app, resolved from this file so no gate hardcodes a repo location. */
export const appTemplateRootPath = fileURLToPath(new URL('..', import.meta.url))

/** Absolute path of the hearthkit repo root; only repo-only gates read it, a generated project has no such thing. */
export const hearthkitRepoRootPath = fileURLToPath(new URL('../../..', import.meta.url))

/** Absolute path of a POSIX-style relative path inside the template. */
export function templateFilePath(templateRelativePath: string): string {
  return join(appTemplateRootPath, ...templateRelativePath.split('/'))
}

/** True when the template holds this relative path as a regular file, false when it is missing or a directory. */
export function templateFileExists(templateRelativePath: string): boolean {
  try {
    return statSync(templateFilePath(templateRelativePath)).isFile()
  } catch {
    return false
  }
}

/** Text of a template file; throws naming the path when the implementor has not written it yet. */
export function readTemplateFileText(templateRelativePath: string): string {
  try {
    return readFileSync(templateFilePath(templateRelativePath), 'utf8')
  } catch (error) {
    throw new Error(
      `gate could not read templates/app/${templateRelativePath} (not written yet?): ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
}

/** Removes // and block comments from JSON text without touching comment-like sequences inside strings. */
function stripJsonComments(jsonText: string): string {
  let stripped = ''
  let insideString = false
  let insideLineComment = false
  let insideBlockComment = false

  for (let index = 0; index < jsonText.length; index += 1) {
    const character = jsonText[index] ?? ''
    const nextCharacter = jsonText[index + 1] ?? ''

    if (insideLineComment) {
      if (character === '\n') {
        insideLineComment = false
        stripped += character
      }
      continue
    }
    if (insideBlockComment) {
      if (character === '*' && nextCharacter === '/') {
        insideBlockComment = false
        index += 1
      }
      continue
    }
    if (insideString) {
      stripped += character
      if (character === '\\') {
        stripped += nextCharacter
        index += 1
        continue
      }
      if (character === '"') {
        insideString = false
      }
      continue
    }
    if (character === '"') {
      insideString = true
      stripped += character
      continue
    }
    if (character === '/' && nextCharacter === '/') {
      insideLineComment = true
      index += 1
      continue
    }
    if (character === '/' && nextCharacter === '*') {
      insideBlockComment = true
      index += 1
      continue
    }
    stripped += character
  }

  return stripped
}

/** Parses JSON that may carry comments or a trailing comma, because tsconfig.json is JSONC by convention. */
export function parseJsonWithComments(
  jsonText: string,
  sourceLabel: string,
): Record<string, unknown> {
  const stripped = stripJsonComments(jsonText)
  const withoutTrailingCommas = stripped.replace(/,(\s*[}\]])/g, '$1')

  let parsed: unknown
  try {
    parsed = JSON.parse(stripped)
  } catch {
    try {
      parsed = JSON.parse(withoutTrailingCommas)
    } catch (error) {
      throw new Error(
        `gate could not parse ${sourceLabel} as JSON: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      )
    }
  }

  if (!isUnknownRecord(parsed) || Array.isArray(parsed)) {
    throw new Error(`gate expected ${sourceLabel} to hold a JSON object`)
  }
  return parsed
}

/** Parsed JSON object of a template file, for package.json and tsconfig.json. */
export function readTemplateJsonFile(templateRelativePath: string): Record<string, unknown> {
  return parseJsonWithComments(
    readTemplateFileText(templateRelativePath),
    `templates/app/${templateRelativePath}`,
  )
}

/** Parsed JSON object at an absolute path, used for the repo's tsconfig.base.json. */
export function readJsonFileAt(absolutePath: string): Record<string, unknown> {
  try {
    return parseJsonWithComments(readFileSync(absolutePath, 'utf8'), absolutePath)
  } catch (error) {
    throw new Error(
      `gate could not read ${absolutePath}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
}

/** Every file in the template as a POSIX relative path, skipping the directory names the caller names. */
export function listTemplateFilePaths(options: {
  skipDirectoryNames: readonly string[]
}): string[] {
  const skipped = new Set(options.skipDirectoryNames)
  const found: string[] = []

  const walkDirectory = (absoluteDirectoryPath: string, relativePrefix: string): void => {
    for (const entry of readdirSync(absoluteDirectoryPath, { withFileTypes: true })) {
      const relativePath = relativePrefix === '' ? entry.name : `${relativePrefix}/${entry.name}`
      if (entry.isDirectory()) {
        if (skipped.has(entry.name)) {
          continue
        }
        walkDirectory(join(absoluteDirectoryPath, entry.name), relativePath)
        continue
      }
      if (entry.isFile()) {
        found.push(relativePath)
      }
    }
  }

  walkDirectory(appTemplateRootPath, '')
  return found.toSorted()
}

/**
 * Every file git tracks under templates/app, as POSIX relative paths.
 *
 * The template artifact is its tracked files, and that distinction is load-bearing for the
 * empty-selection gate: `next-env.d.ts` and `tsconfig.tsbuildinfo` are gitignored build output that
 * appear in the working tree the moment anyone runs `pnpm typecheck` here, and they are named in
 * neither appTemplateNeverCopiedDirectoryNames nor any guaranteed path list. Walking the directory
 * instead would make "an empty selection reproduces appGeneratedProjectGuaranteedPaths exactly" pass
 * or fail depending on whether the last command someone ran wrote a cache file.
 */
export function trackedTemplateFilePaths(): string[] {
  let trackedOutput: string
  try {
    trackedOutput = execFileSync('git', ['ls-files', '-z'], {
      cwd: appTemplateRootPath,
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

/** Every module specifier a file references, covering ESM imports, require calls, CSS @import and Tailwind @source. */
export function importSpecifiersInText(fileText: string): string[] {
  const specifierPattern =
    /(?:\bfrom|\bimport|\brequire|@import|@source)\s*\(?\s*(?:url\(\s*)?['"]([^'"\n]+)['"]/g
  const specifiers: string[] = []

  for (const match of fileText.matchAll(specifierPattern)) {
    const specifier = match[1]
    if (specifier !== undefined) {
      specifiers.push(specifier)
    }
  }

  return specifiers
}

/** Resolves a relative specifier against the file that wrote it, as a POSIX path from the template root. */
export function resolveTemplateRelativeSpecifier(
  importingFilePath: string,
  specifier: string,
): string {
  const resolved = posix.normalize(posix.join(posix.dirname(importingFilePath), specifier))
  return resolved.startsWith('./') ? resolved.slice(2) : resolved
}

/**
 * Trimmed lines with blanks and whole-line comments dropped; how the gates read globals.css and
 * gitignore. The comment prefixes are the caller's because `*.tsbuildinfo` is an ignore entry while
 * a leading `*` in CSS is a comment continuation.
 */
export function meaningfulLines(fileText: string, commentPrefixes: readonly string[]): string[] {
  return fileText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .filter((line) => !commentPrefixes.some((prefix) => line.startsWith(prefix)))
}
