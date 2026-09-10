import { loadHearthkitConfig } from '@hearthkit/config'
import { describe, expect, it } from 'vitest'
import { expectResultKind } from '../test-fixtures/auth-gate-expectations.ts'
import {
  readAuthPackageManifest,
  runAuthContractModulesUnderBareNode,
} from '../test-fixtures/auth-package-entry-points.ts'
import {
  hearthkitAuthContractSubpathValueExportNames,
  hearthkitAuthEntryValueExportNames,
  importHearthkitAuthContractSubpathNamespace,
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
  it('exports exactly the thirty-five allowlisted values and nothing else, each contract value the one auth-contract.ts already exports', async () => {
    const namespace = await importHearthkitAuthNamespace()
    const contractModule = authContract as unknown as Record<string, unknown>

    // A module namespace carries value exports only, so every `export type` is already erased here and
    // the types CONTRACT.md keeps on the entry point are covered by typecheck instead. Both lists are
    // compared whole rather than name by name, so a failure names every wrong export at once instead
    // of stopping at the first and hiding the rest behind a rerun.
    const actualValueExportNames = Object.keys(namespace)
      .filter((exportName) => namespace[exportName] !== undefined)
      .toSorted()
    expect(
      actualValueExportNames,
      'src/index.ts must export exactly the allowlist in CONTRACT.md "Package entry point"',
    ).toEqual([...hearthkitAuthEntryValueExportNames].toSorted())

    // The twenty-two contract values must be the identical values auth-contract.ts exports, not a
    // second copy: an app comparing entry.hearthkitAuthTableNames against the subpath's value is
    // comparing the same thing. The prefixes, the Better Auth literals, the HTTP statuses, the limits,
    // the options schemas and the per-variant failure shapes stay internal, so they are absent from
    // the list above and a re-export of one of them fails the whole-list comparison by name.
    const rebuiltInsteadOfReExported = hearthkitAuthContractSubpathValueExportNames.filter(
      (exportName) => namespace[exportName] !== contractModule[exportName],
    )
    expect(
      rebuiltInsteadOfReExported,
      'these must be the identical value auth-contract.ts exports, not a second copy of it',
    ).toEqual([])

    // Everything else on the allowlist comes from an implementation module: the twelve functions, plus
    // hearthkitAuthDrizzleSchema, which is the Drizzle table map and therefore an object. Whether it
    // carries the right tables is the conformance gate's job, not this one's.
    const wrongShape = hearthkitAuthEntryValueExportNames.filter((exportName) => {
      const isContractValue = hearthkitAuthContractSubpathValueExportNames.includes(
        exportName as (typeof hearthkitAuthContractSubpathValueExportNames)[number],
      )
      if (isContractValue) {
        return false
      }
      if (exportName === 'hearthkitAuthDrizzleSchema') {
        return typeof namespace[exportName] !== 'object' || namespace[exportName] === null
      }
      return typeof namespace[exportName] !== 'function'
    })
    expect(
      wrongShape,
      'every allowlisted name outside the twenty-two contract values must be one of the twelve functions, or the Drizzle schema object',
    ).toEqual([])
  })

  it('publishes ./auth-contract as a second subpath carrying the twenty-two contract values, loadable by a bare node process', async () => {
    const manifest = await readAuthPackageManifest()
    expect(manifest.packageName).toBe('@hearthkit/auth')
    expect(Object.keys(manifest.exportsMap).toSorted()).toEqual(['.', './auth-contract'])
    expect(JSON.stringify(manifest.exportsMap['./auth-contract'])).toContain(
      './src/auth-contract-entry.ts',
    )

    const subpathNamespace = await importHearthkitAuthContractSubpathNamespace()
    const contractModule = authContract as unknown as Record<string, unknown>
    const subpathValueExportNames = Object.keys(subpathNamespace)
      .filter((exportName) => subpathNamespace[exportName] !== undefined)
      .toSorted()
    expect(
      subpathValueExportNames,
      'src/auth-contract-entry.ts must export exactly the twenty-two allowlisted names that live in auth-contract.ts',
    ).toEqual([...hearthkitAuthContractSubpathValueExportNames].toSorted())

    const rebuiltInsteadOfReExported = hearthkitAuthContractSubpathValueExportNames.filter(
      (exportName) => subpathNamespace[exportName] !== contractModule[exportName],
    )
    expect(
      rebuiltInsteadOfReExported,
      'these must be the identical value auth-contract.ts exports, not a second copy of it',
    ).toEqual([])

    // The reason the subpath exists: the `.` entry reaches @hearthkit/email's .tsx templates and
    // better-auth/react, which bare node refuses, while both of these files import zod at runtime and
    // nothing else. Each is run on its own so a failure names the file, and stderr must be empty as
    // well as the exit code zero, because a module that warns on load still breaks a bare consumer.
    for (const bareNodeRun of await runAuthContractModulesUnderBareNode()) {
      expect(bareNodeRun.exitCode, `${bareNodeRun.modulePath}: ${bareNodeRun.standardError}`).toBe(
        0,
      )
      expect(bareNodeRun.standardError, `${bareNodeRun.modulePath} wrote to stderr`).toBe('')
    }
  })
})
