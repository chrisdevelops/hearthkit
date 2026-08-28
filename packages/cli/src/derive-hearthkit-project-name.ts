import { hearthkitProjectNameSchema, type HearthkitProjectName } from './cli-contract.js'

/** What a manifest name becomes when nothing usable survives sanitising, so compose always has a project name. */
const fallbackHearthkitProjectName = hearthkitProjectNameSchema.parse('hearthkit-app')

/** Compose project names, like the container and volume names built from them, cap at 63 characters. */
const hearthkitProjectNameLengthLimit = 63

/**
 * Turns a package.json name into the name compose, containers, and volumes are built from: the
 * leading @scope/ is dropped, the rest is lowercased, and anything outside [a-z0-9-] becomes a dash.
 * A result that still cannot be a project name (empty, or not starting with a letter) falls back.
 */
export function deriveHearthkitProjectName(manifestName: string | undefined): HearthkitProjectName {
  if (manifestName === undefined) {
    return fallbackHearthkitProjectName
  }

  const sanitized = manifestName
    .replace(/^@[^/]+\//, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9-]/g, '-')
    .slice(0, hearthkitProjectNameLengthLimit)

  const parsed = hearthkitProjectNameSchema.safeParse(sanitized)
  return parsed.success ? parsed.data : fallbackHearthkitProjectName
}
