import { loadHearthkitConfig } from '@hearthkit/config'
import { describe, expect, it } from 'vitest'
import { expectResultKind } from '../test-fixtures/auth-gate-expectations.ts'
import {
  readAuthPackageManifest,
  runAuthContractUnderBareNode,
} from '../test-fixtures/auth-package-entry-points.ts'
import {
  importHearthkitAuthNamespace,
  loadHearthkitAuthEntry,
} from '../test-fixtures/hearthkit-auth-entry.ts'
import * as authContract from './auth-contract.ts'

const everyAuthVariableName = [
  'AUTH_BASE_URL',
  'AUTH_SECRET',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
] as const

const completeAuthEnv = {
  AUTH_SECRET: '0123456789abcdef0123456789abcdef',
  AUTH_BASE_URL: 'http://localhost:3000',
}

const optionalAuthVariableNames = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
] as const

// CONTRACT.md's entry point rule is mechanical: src/index.ts re-exports every value
// src/auth-contract.ts exports, with no exceptions. So the required list is read off the contract
// module's own namespace rather than typed out here. A hand-written list would fall behind the day
// someone forgot to extend it; a derived list cannot.
//
// A module namespace carries value exports only. Every `export type` in auth-contract.ts is erased
// before this file runs, so the types CONTRACT.md also asks the entry point to re-export are outside
// what this gate can see and are covered by typecheck instead.
function contractValueExportNames(contractModule: Record<string, unknown>): string[] {
  return Object.keys(contractModule).toSorted()
}

// Named in so many words by CONTRACT.md: the nine message prefixes, the env fragment, the failure
// union and the ten per-function result schemas. Spelled out as strings so renaming one in the
// contract fails this gate loudly, instead of quietly shrinking the derived list above to a set an
// entry point already satisfies.
const contractExportNamesTheContractNamesOutright = [
  'authOauthConfigIncompleteErrorPrefix',
  'authInvalidCredentialsErrorPrefix',
  'authMagicLinkInvalidErrorPrefix',
  'authInputInvalidErrorPrefix',
  'authEmailAlreadyRegisteredErrorPrefix',
  'authEmailSendFailedErrorPrefix',
  'authOrganizationsDisabledErrorPrefix',
  'authDatabaseUnavailableErrorPrefix',
  'authRequestFailedErrorPrefix',
  'authEnvSchemaFragment',
  'authFailureSchema',
  'hearthkitAuthTableNames',
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
] as const

// Not exported by auth-contract.ts, so the derived list cannot cover them: the twelve public
// functions and the Drizzle table map.
const entryPointOnlyExportNames = [
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
] as const

describe('authEnvSchemaFragment', () => {
  it('declares six variables, requires only AUTH_SECRET and AUTH_BASE_URL, and treats an empty OAuth value as unset', async () => {
    const { authEnvSchemaFragment } = await loadHearthkitAuthEntry()
    expect(Object.keys(authEnvSchemaFragment.shape).toSorted()).toEqual([...everyAuthVariableName])

    const nothingSet = expectResultKind(
      loadHearthkitConfig({ fragments: [authEnvSchemaFragment], env: {} }),
      'config-validation-failed',
    )
    expect(nothingSet.message).toContain('AUTH_SECRET')
    expect(nothingSet.message).toContain('AUTH_BASE_URL')
    expect(nothingSet.issues).toHaveLength(2)
    // Both halves of both OAuth pairs are optional in the fragment on purpose. A flat object cannot
    // say "required together", and composeEnvSchemaFragments silently discards a .refine attached to
    // a fragment, which is why resolveAuthRuntimeConfig owns the pairing check instead.
    for (const optionalVariableName of optionalAuthVariableNames) {
      expect(nothingSet.message).not.toContain(optionalVariableName)
    }

    const loaded = expectResultKind(
      loadHearthkitConfig({
        fragments: [authEnvSchemaFragment],
        env: { ...completeAuthEnv, GOOGLE_CLIENT_ID: '', GITHUB_CLIENT_SECRET: '' },
      }),
      'config-loaded',
    )
    expect(String(loaded.config.AUTH_SECRET)).toBe(completeAuthEnv.AUTH_SECRET)
    expect(String(loaded.config.AUTH_BASE_URL)).toBe(completeAuthEnv.AUTH_BASE_URL)
    expect(loaded.config.GOOGLE_CLIENT_ID).toBeUndefined()
    expect(loaded.config.GITHUB_CLIENT_SECRET).toBeUndefined()

    const withProviders = expectResultKind(
      loadHearthkitConfig({
        fragments: [authEnvSchemaFragment],
        env: {
          ...completeAuthEnv,
          GOOGLE_CLIENT_ID: '1234.apps.googleusercontent.com',
          GOOGLE_CLIENT_SECRET: 'GOCSPX-abc123',
        },
      }),
      'config-loaded',
    )
    expect(String(withProviders.config.GOOGLE_CLIENT_ID)).toBe('1234.apps.googleusercontent.com')
    expect(String(withProviders.config.GOOGLE_CLIENT_SECRET)).toBe('GOCSPX-abc123')
  })

  it('fails at load and names every variable whose value is not legal, including an AUTH_BASE_URL carrying the /api/auth path', async () => {
    const { authEnvSchemaFragment } = await loadHearthkitAuthEntry()

    const failure = expectResultKind(
      loadHearthkitConfig({
        fragments: [authEnvSchemaFragment],
        env: {
          // One character short of the thirty-two Better Auth documents for its own secret.
          AUTH_SECRET: '0123456789abcdef0123456789abcde',
          // Pasting the full route URL into the origin is the mistake the empty-path rule catches: it
          // doubles the base path and breaks every link and redirect as if it were a routing bug.
          AUTH_BASE_URL: 'https://example.com/api/auth',
        },
      }),
      'config-validation-failed',
    )

    expect(failure.message).toContain('AUTH_SECRET')
    expect(failure.message).toContain('AUTH_BASE_URL')
    expect(failure.issues).toHaveLength(2)
  })
})

describe('@hearthkit/auth entry point', () => {
  it('re-exports by name every value auth-contract.ts exports, plus the twelve functions and the Drizzle schema', async () => {
    const namespace = await importHearthkitAuthNamespace()
    const contractModule = authContract as unknown as Record<string, unknown>
    const requiredExportNames = contractValueExportNames(contractModule)

    const renamedInTheContract = contractExportNamesTheContractNamesOutright.filter(
      (exportName) => !requiredExportNames.includes(exportName),
    )
    expect(
      renamedInTheContract,
      'auth-contract.ts must still export the constants and schemas CONTRACT.md names outright',
    ).toEqual([])

    // Both lists are compared whole rather than one name at a time, so a failure names every export
    // that is wrong instead of stopping at the first and hiding the rest behind a rerun.
    const missingFromTheEntryPoint = requiredExportNames.filter(
      (exportName) => namespace[exportName] === undefined,
    )
    expect(
      missingFromTheEntryPoint,
      'src/index.ts must re-export these by name from auth-contract.ts',
    ).toEqual([])

    const rebuiltInsteadOfReExported = requiredExportNames.filter(
      (exportName) => namespace[exportName] !== contractModule[exportName],
    )
    expect(
      rebuiltInsteadOfReExported,
      'these must be the identical value auth-contract.ts exports, not a second copy of it',
    ).toEqual([])

    const missingImplementationExports = entryPointOnlyExportNames.filter(
      (exportName) => namespace[exportName] === undefined,
    )
    expect(
      missingImplementationExports,
      'src/index.ts must re-export the public functions and the Drizzle schema by name',
    ).toEqual([])
  })

  it('publishes ./auth-contract as a second subpath that a bare node process can load', async () => {
    const manifest = await readAuthPackageManifest()
    expect(manifest.packageName).toBe('@hearthkit/auth')
    expect(Object.keys(manifest.exportsMap).toSorted()).toEqual(['.', './auth-contract'])
    expect(JSON.stringify(manifest.exportsMap['./auth-contract'])).toContain(
      './src/auth-contract.ts',
    )

    // The reason the subpath exists: the `.` entry reaches @hearthkit/email's .tsx templates and
    // better-auth/react, which bare node refuses, while this file imports zod at runtime and nothing
    // else and must load on its own for @hearthkit/payments to consume it.
    const bareNodeRun = await runAuthContractUnderBareNode()
    expect(bareNodeRun.exitCode, bareNodeRun.standardError).toBe(0)
  })
})
