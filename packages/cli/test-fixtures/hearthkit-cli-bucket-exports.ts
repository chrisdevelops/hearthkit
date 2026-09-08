import type {
  DeriveLocalStorageBucketName,
  HearthkitProjectName,
  LocalStorageBucketName,
} from '../src/cli-contract.ts'

/**
 * The parse surface a gate needs from localStorageBucketNameSchema, described structurally so this
 * fixture never imports the schema value from an internal module and can only ever see the one the
 * public entry point re-exports.
 */
export type LocalStorageBucketNameParser = {
  parse: (value: unknown) => LocalStorageBucketName
}

/** Exactly the surface the Phase 5 bucket amendment adds to @hearthkit/cli; nothing else may be reached from a gate. */
export type HearthkitCliBucketExports = {
  deriveLocalStorageBucketName: DeriveLocalStorageBucketName
  deriveHearthkitProjectName: (manifestName: string | undefined) => HearthkitProjectName
  localStorageBucketInitServiceName: string
  localStorageBucketInitImage: string
  localStorageBucketNameSchema: LocalStorageBucketNameParser
}

/** A named export the loader insists on, with the runtime shape that proves it is really there. */
type ExpectedBucketExport = {
  exportName: keyof HearthkitCliBucketExports
  isPresent: (value: unknown) => boolean
  expectedShape: string
}

const expectedBucketExports: readonly ExpectedBucketExport[] = [
  {
    exportName: 'deriveLocalStorageBucketName',
    isPresent: (value) => typeof value === 'function',
    expectedShape: 'a function',
  },
  {
    exportName: 'deriveHearthkitProjectName',
    isPresent: (value) => typeof value === 'function',
    expectedShape: 'a function',
  },
  {
    exportName: 'localStorageBucketInitServiceName',
    isPresent: (value) => typeof value === 'string' && value.length > 0,
    expectedShape: 'a non-empty string',
  },
  {
    exportName: 'localStorageBucketInitImage',
    isPresent: (value) => typeof value === 'string' && value.length > 0,
    expectedShape: 'a non-empty string',
  },
  {
    exportName: 'localStorageBucketNameSchema',
    isPresent: (value) =>
      typeof value === 'object' &&
      value !== null &&
      typeof (value as { parse?: unknown }).parse === 'function',
    expectedShape: 'a zod schema with a parse method',
  },
]

/**
 * Loads the bucket surface through the public entry point and refuses to hand back anything that is
 * missing. This repo's Vitest resolves an absent named export to undefined instead of throwing, so
 * without this check a gate could read undefined and go green while asserting nothing.
 */
export async function loadHearthkitCliBucketExports(): Promise<HearthkitCliBucketExports> {
  let loaded: unknown
  try {
    loaded = await import('@hearthkit/cli')
  } catch (error) {
    throw new Error(
      `gate could not load the public entry point of @hearthkit/cli (not implemented yet?): ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }

  const namespace = loaded as Partial<Record<keyof HearthkitCliBucketExports, unknown>>
  const missingExports = expectedBucketExports.filter(
    (expected) => !expected.isPresent(namespace[expected.exportName]),
  )
  if (missingExports.length > 0) {
    throw new Error(
      `gate expected @hearthkit/cli to export ${missingExports
        .map((expected) => `${expected.exportName} as ${expected.expectedShape}`)
        .join(', ')}`,
    )
  }

  return namespace as HearthkitCliBucketExports
}
