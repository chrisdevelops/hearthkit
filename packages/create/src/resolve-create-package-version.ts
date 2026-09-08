import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * The default dependency specifier every `@hearthkit/*` entry in a generated package.json gets: the
 * version of this package itself, so a project scaffolded by 0.4.2 asks for 0.4.2 of every package it
 * was cut from. Read from the manifest rather than written out, because a second copy of a version
 * number is a second thing to bump.
 */

/** Unique literal prefix reported when this package's own manifest cannot be read for its version. */
export const createPackageVersionUnreadableErrorPrefix =
  'hearthkit create package version unreadable:'

/** The version in this package's own package.json; the packageVersion default when no flag gives one. */
export const createPackageVersion = ((): string => {
  const manifestPath = fileURLToPath(new URL('../package.json', import.meta.url))
  const parsed: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const version =
    typeof parsed === 'object' && parsed !== null && 'version' in parsed
      ? parsed.version
      : undefined
  if (typeof version !== 'string' || version === '') {
    throw new Error(
      `${createPackageVersionUnreadableErrorPrefix} ${manifestPath} declares no version`,
    )
  }
  return version
})()
