import { existsSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/**
 * `prepublishOnly` guard for every `@hearthkit/*` package, run from the package directory.
 *
 * The packages ship TypeScript source with no build step, so nothing else ever validates that the
 * tarball is complete. This checks that the manifest is publishable (not private, versioned past
 * 0.0.0), that `src/index.ts` exists, and that every `exports` and `bin` target both exists and
 * sits under a `files` entry. Targets may be `.ts` or `.js`: `@hearthkit/config` ships one
 * JavaScript module, `register-node-modules-type-stripping.js`, and the two bins are JavaScript.
 *
 * The 0.0.0 check stops a publish that skipped `changeset version`. A local
 * `pnpm publish --dry-run` at 0.0.0 can set `HEARTHKIT_PUBLISH_GUARD_ALLOW_UNVERSIONED=1`.
 */

/** Unique literal prefix of every failure this guard reports. */
const packageNotPublishableErrorPrefix = 'hearthkit package not publishable:'

const packageDirectoryPath = process.cwd()
const manifestPath = join(packageDirectoryPath, 'package.json')

/** Narrows parsed JSON to a plain object so its fields can be read as unknowns without a cast. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

const parsedManifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'))
if (!isPlainObject(parsedManifest)) {
  process.stderr.write(`${packageNotPublishableErrorPrefix} ${manifestPath} is not a JSON object\n`)
  process.exit(1)
}
const manifest = parsedManifest
const packageName = typeof manifest.name === 'string' ? manifest.name : manifestPath
const problems: string[] = []

if (manifest.private === true) {
  problems.push('package is private')
}
if (typeof manifest.version !== 'string' || manifest.version === '') {
  problems.push('version is missing')
} else if (
  manifest.version === '0.0.0' &&
  process.env.HEARTHKIT_PUBLISH_GUARD_ALLOW_UNVERSIONED !== '1'
) {
  problems.push('version is 0.0.0; run `pnpm changeset version` first')
}

const filesEntries = Array.isArray(manifest.files)
  ? manifest.files.filter((entry): entry is string => typeof entry === 'string')
  : []
if (filesEntries.length === 0) {
  problems.push('"files" is missing or empty')
}

/** Collects every string leaf of an `exports` or `bin` value, whatever its nesting. */
function collectTargetPaths(value: unknown, collected: string[] = []): string[] {
  if (typeof value === 'string') {
    collected.push(value)
  } else if (Array.isArray(value)) {
    for (const item of value) {
      collectTargetPaths(item, collected)
    }
  } else if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) {
      collectTargetPaths(item, collected)
    }
  }
  return collected
}

const targetPaths = [
  'src/index.ts',
  ...collectTargetPaths(manifest.exports),
  ...collectTargetPaths(manifest.bin),
]

for (const targetPath of targetPaths) {
  const normalized = relative(packageDirectoryPath, resolve(packageDirectoryPath, targetPath))
  if (normalized.startsWith('..')) {
    problems.push(`target ${targetPath} points outside the package`)
    continue
  }
  if (!existsSync(join(packageDirectoryPath, normalized))) {
    problems.push(`target ${targetPath} does not exist`)
  }
  const shipped = filesEntries.some(
    (entry) => normalized === entry || normalized.startsWith(`${entry}/`),
  )
  if (!shipped) {
    problems.push(
      `target ${targetPath} is not under any "files" entry (${filesEntries.join(', ')})`,
    )
  }
}

if (problems.length > 0) {
  for (const problem of problems) {
    process.stderr.write(`${packageNotPublishableErrorPrefix} ${packageName}: ${problem}\n`)
  }
  process.exit(1)
}
process.stdout.write(
  `${packageName} is publishable: ${String(targetPaths.length)} shipped targets verified\n`,
)
