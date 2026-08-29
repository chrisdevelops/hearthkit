import { describe, expect, it } from 'vitest'
import { loadHearthkitCliBucketExports } from '../test-fixtures/hearthkit-cli-bucket-exports.ts'
import { hearthkitProjectNameSchema } from './cli-contract.ts'

/** The shortest and longest bucket names the derivation can ever produce, per the contract's totality claim. */
const shortestPossibleBucketNameLength = 9
const longestPossibleBucketNameLength = 63

/**
 * The project names that decide whether the function is total. hearthkitProjectNameSchema is
 * /^[a-z][a-z0-9-]*$/ with max(63), so a project name may be one character, may end in a hyphen, and
 * may be 63 characters — and the last case may be 63 characters of which 62 are hyphens.
 */
const bucketNameEdgeCases = [
  {
    hearthkitProjectName: 'a',
    expectedBucketName: 'a-uploads',
    edge: 'the shortest project name the schema accepts',
  },
  {
    hearthkitProjectName: 'my-app-',
    expectedBucketName: 'my-app-uploads',
    edge: 'a trailing hyphen, which must not become my-app--uploads',
  },
  {
    hearthkitProjectName: 'a'.repeat(63),
    expectedBucketName: `${'a'.repeat(55)}-uploads`,
    edge: 'the longest project name the schema accepts, cut to 55 so the bucket name lands on exactly 63',
  },
  {
    hearthkitProjectName: `a${'-'.repeat(62)}`,
    expectedBucketName: 'a-uploads',
    edge: 'truncation leaving nothing but hyphens, which must collapse rather than yield a trailing-hyphen name',
  },
] as const

describe('deriveLocalStorageBucketName', () => {
  it('derives the project-uploads bucket name the generated compose file creates in MinIO', async () => {
    const { deriveLocalStorageBucketName, localStorageBucketNameSchema } =
      await loadHearthkitCliBucketExports()

    const localStorageBucketName = deriveLocalStorageBucketName(
      hearthkitProjectNameSchema.parse('myapp'),
    )

    expect(localStorageBucketName).toBe('myapp-uploads')
    expect(localStorageBucketNameSchema.parse(localStorageBucketName)).toBe('myapp-uploads')
  })

  it.each(bucketNameEdgeCases)(
    'stays total for a project name that is $edge',
    async ({ hearthkitProjectName, expectedBucketName }) => {
      const { deriveLocalStorageBucketName, localStorageBucketNameSchema } =
        await loadHearthkitCliBucketExports()
      // Parsing first proves the gate is feeding the function an input the contract really allows,
      // rather than inventing one the schema would have rejected anyway.
      const parsedProjectName = hearthkitProjectNameSchema.parse(hearthkitProjectName)

      const localStorageBucketName = deriveLocalStorageBucketName(parsedProjectName)

      expect(localStorageBucketName).toBe(expectedBucketName)
      // Totality is the reason the function has no failure mode: every accepted project name has to
      // produce a name localStorageBucketNameSchema accepts, within the 9-to-63 range the contract states.
      expect(localStorageBucketNameSchema.parse(localStorageBucketName)).toBe(expectedBucketName)
      expect(localStorageBucketName.length).toBeGreaterThanOrEqual(shortestPossibleBucketNameLength)
      expect(localStorageBucketName.length).toBeLessThanOrEqual(longestPossibleBucketNameLength)
    },
  )

  it('reaches the same project name, and so the same bucket name, the CLI derives from a package.json name', async () => {
    const {
      deriveHearthkitProjectName,
      deriveLocalStorageBucketName,
      localStorageBucketNameSchema,
    } = await loadHearthkitCliBucketExports()

    // Promoted to the public surface by this amendment: without it @hearthkit/create cannot reach
    // the project name the bucket name is built from, so it would re-implement the sanitiser.
    expect(deriveHearthkitProjectName('@gate/My_App')).toBe('my-app')
    expect(deriveHearthkitProjectName(undefined)).toBe('hearthkit-app')

    const localStorageBucketName = deriveLocalStorageBucketName(
      deriveHearthkitProjectName('@gate/My_App'),
    )

    expect(localStorageBucketName).toBe('my-app-uploads')
    expect(localStorageBucketNameSchema.parse(localStorageBucketName)).toBe('my-app-uploads')
  })
})
