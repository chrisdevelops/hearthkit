import type * as authContract from '../src/auth-contract.ts'
import type {
  AddAuthOrganizationMember,
  CompleteMagicLinkSignIn,
  CreateAuthBrowserClient,
  CreateAuthOrganization,
  CreateAuthRouteHandlers,
  CreateAuthServerInstance,
  HearthkitAuthDrizzleSchema,
  ReadAuthSession,
  RequestMagicLinkSignIn,
  ResolveAuthRuntimeConfig,
  SignInWithPassword,
  SignUpWithPassword,
  VerifyAuthTablesExist,
} from '../src/auth-contract.ts'

/** The env fragment's own type, read off the contract module so this fixture declares no second copy of it. */
export type AuthEnvSchemaFragment = typeof authContract.authEnvSchemaFragment

/** The whole public surface a gate is allowed to call; nothing here may be imported from an internal module. */
export type HearthkitAuthEntry = {
  resolveAuthRuntimeConfig: ResolveAuthRuntimeConfig
  createAuthServerInstance: CreateAuthServerInstance
  createAuthRouteHandlers: CreateAuthRouteHandlers
  createAuthBrowserClient: CreateAuthBrowserClient
  readAuthSession: ReadAuthSession
  signUpWithPassword: SignUpWithPassword
  signInWithPassword: SignInWithPassword
  requestMagicLinkSignIn: RequestMagicLinkSignIn
  completeMagicLinkSignIn: CompleteMagicLinkSignIn
  createAuthOrganization: CreateAuthOrganization
  addAuthOrganizationMember: AddAuthOrganizationMember
  verifyAuthTablesExist: VerifyAuthTablesExist
  authEnvSchemaFragment: AuthEnvSchemaFragment
  hearthkitAuthDrizzleSchema: HearthkitAuthDrizzleSchema
}

// The twelve functions CONTRACT.md lists under Public functions, spelled out so a rename fails here by
// name instead of surfacing as "x is not a function" inside whichever gate ran first.
const expectedFunctionNames = [
  'resolveAuthRuntimeConfig',
  'createAuthServerInstance',
  'createAuthRouteHandlers',
  'createAuthBrowserClient',
  'readAuthSession',
  'signUpWithPassword',
  'signInWithPassword',
  'requestMagicLinkSignIn',
  'completeMagicLinkSignIn',
  'createAuthOrganization',
  'addAuthOrganizationMember',
  'verifyAuthTablesExist',
] as const

/**
 * Imports @hearthkit/auth through its public entry point at call time, so a package with no
 * implementation yet fails one gate at a time instead of breaking collection for a whole file.
 */
export async function importHearthkitAuthNamespace(): Promise<Record<string, unknown>> {
  try {
    return (await import('@hearthkit/auth')) as Record<string, unknown>
  } catch (error) {
    throw new Error(
      `gate could not load the public entry point of @hearthkit/auth (not implemented yet?): ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * The public entry point narrowed to the surface the contract promises. Throws naming whatever is not
 * exported yet, because a missing named export resolves to undefined rather than throwing in this
 * repo's Vitest setup, which would let a gate pass while checking nothing.
 */
export async function loadHearthkitAuthEntry(): Promise<HearthkitAuthEntry> {
  const namespace = await importHearthkitAuthNamespace()

  const missingNames: string[] = expectedFunctionNames.filter(
    (exportName) => typeof namespace[exportName] !== 'function',
  )
  if (namespace.authEnvSchemaFragment === undefined) {
    missingNames.push('authEnvSchemaFragment')
  }
  // Only checked for being an object here. Whether it carries the right tables and fields is the
  // conformance gate's job, and doing it here would make every database gate fail with that answer.
  if (
    typeof namespace.hearthkitAuthDrizzleSchema !== 'object' ||
    namespace.hearthkitAuthDrizzleSchema === null
  ) {
    missingNames.push('hearthkitAuthDrizzleSchema')
  }
  if (missingNames.length > 0) {
    throw new Error(`gate expected @hearthkit/auth to export ${missingNames.join(', ')}`)
  }

  return namespace as unknown as HearthkitAuthEntry
}
