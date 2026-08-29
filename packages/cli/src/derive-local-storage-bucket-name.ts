import { localStorageBucketNameSchema, type DeriveLocalStorageBucketName } from './cli-contract.ts'

/** What every derived bucket name ends in, so a reader of the compose file knows at a glance what the bucket holds. */
const localStorageBucketNameSuffix = '-uploads'

/** Longest project name that still leaves room for the suffix inside the 63-character bucket name limit. */
const truncatedProjectNameLengthLimit = 63 - localStorageBucketNameSuffix.length

/**
 * Derives the bucket name the generated compose file creates in MinIO and @hearthkit/create writes to
 * STORAGE_BUCKET, so the two cannot drift. Total by construction rather than by validation: the name
 * is cut to 55 characters and any hyphens left trailing are dropped before the suffix is appended, so
 * every project name hearthkitProjectNameSchema accepts — one character, ending in a hyphen, or 63
 * characters of which 62 are hyphens — yields a name localStorageBucketNameSchema accepts.
 */
export const deriveLocalStorageBucketName: DeriveLocalStorageBucketName = (
  hearthkitProjectName,
) => {
  const truncated = hearthkitProjectName.slice(0, truncatedProjectNameLengthLimit)
  const withoutTrailingHyphens = truncated.replace(/-+$/, '')
  return localStorageBucketNameSchema.parse(
    `${withoutTrailingHyphens}${localStorageBucketNameSuffix}`,
  )
}
