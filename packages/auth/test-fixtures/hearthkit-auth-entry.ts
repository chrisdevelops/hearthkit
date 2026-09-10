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

/**
 * The thirty-five value exports CONTRACT.md "Package entry point" allows src/index.ts to have,
 * spelled out because the allowlist is a decision no module namespace can be derived from: the
 * thirteen plan-named implementation outputs first, then the twenty-two contract values that live in
 * auth-contract.ts. Every other value auth-contract.ts exports is internal and must stay off the
 * entry point.
 */
export const hearthkitAuthEntryValueExportNames = [
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
  'hearthkitAuthDrizzleSchema',
  'authEnvSchemaFragment',
  'authFailureSchema',
  'authRuntimeConfigSchema',
  'resolveAuthRuntimeConfigResultSchema',
  'createAuthServerInstanceResultSchema',
  'readAuthSessionResultSchema',
  'signUpWithPasswordResultSchema',
  'signInWithPasswordResultSchema',
  'requestMagicLinkSignInResultSchema',
  'completeMagicLinkSignInResultSchema',
  'createAuthOrganizationResultSchema',
  'addAuthOrganizationMemberResultSchema',
  'verifyAuthTablesExistResultSchema',
  'authApiBasePath',
  'hearthkitAuthTableNames',
  'authUserIdSchema',
  'authOrganizationIdSchema',
  'authUserEmailSchema',
  'authPasswordSchema',
  'authUserNameSchema',
  'authOrganizationNameSchema',
  'authOrganizationSlugSchema',
] as const

/**
 * The twenty-two allowlisted names the ./auth-contract subpath carries: the list above minus the
 * thirteen implementation outputs, which live in modules that reach @hearthkit/email's .tsx templates
 * and better-auth/react, neither of which a bare node process will load.
 */
export const hearthkitAuthContractSubpathValueExportNames = [
  'authEnvSchemaFragment',
  'authFailureSchema',
  'authRuntimeConfigSchema',
  'resolveAuthRuntimeConfigResultSchema',
  'createAuthServerInstanceResultSchema',
  'readAuthSessionResultSchema',
  'signUpWithPasswordResultSchema',
  'signInWithPasswordResultSchema',
  'requestMagicLinkSignInResultSchema',
  'completeMagicLinkSignInResultSchema',
  'createAuthOrganizationResultSchema',
  'addAuthOrganizationMemberResultSchema',
  'verifyAuthTablesExistResultSchema',
  'authApiBasePath',
  'hearthkitAuthTableNames',
  'authUserIdSchema',
  'authOrganizationIdSchema',
  'authUserEmailSchema',
  'authPasswordSchema',
  'authUserNameSchema',
  'authOrganizationNameSchema',
  'authOrganizationSlugSchema',
] as const

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
      { cause: error },
    )
  }
}

/**
 * Imports the ./auth-contract subpath at call time, so a subpath that still points at a module nobody
 * has written yet fails one gate instead of breaking collection for a whole file. @hearthkit/payments
 * and templates/app both consume this subpath, so it carries its own allowlist.
 */
export async function importHearthkitAuthContractSubpathNamespace(): Promise<
  Record<string, unknown>
> {
  try {
    return (await import('@hearthkit/auth/auth-contract')) as Record<string, unknown>
  } catch (error) {
    throw new Error(
      `gate could not load the ./auth-contract subpath of @hearthkit/auth (not implemented yet?): ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
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
