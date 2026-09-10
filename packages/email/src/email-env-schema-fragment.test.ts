import { loadHearthkitConfig } from '@hearthkit/config'
import { describe, expect, it } from 'vitest'
import { expectResultKind } from '../test-fixtures/email-gate-expectations.ts'
import {
  readEmailPackageManifest,
  runEmailContractUnderBareNode,
} from '../test-fixtures/email-package-entry-points.ts'
import {
  hearthkitEmailContractSubpathValueExportNames,
  hearthkitEmailEntryValueExportNames,
  importHearthkitEmailContractSubpathNamespace,
  importHearthkitEmailNamespace,
  loadHearthkitEmailEntry,
} from '../test-fixtures/hearthkit-email-entry.ts'
import * as emailContract from './email-contract.ts'
import { defaultResendBaseUrl, transactionalEmailTemplateSchema } from './email-contract.ts'

const completeSmtpEmailEnv = {
  EMAIL_TRANSPORT: 'smtp',
  EMAIL_FROM: 'Hearthkit Gate <gate@hearthkit.test>',
  EMAIL_SMTP_HOST: '127.0.0.1',
  EMAIL_SMTP_PORT: '1025',
}

const everyEmailVariableName = [
  'EMAIL_FROM',
  'EMAIL_RESEND_API_KEY',
  'EMAIL_RESEND_BASE_URL',
  'EMAIL_SMTP_HOST',
  'EMAIL_SMTP_PASSWORD',
  'EMAIL_SMTP_PORT',
  'EMAIL_SMTP_USER',
  'EMAIL_TRANSPORT',
] as const

describe('emailEnvSchemaFragment', () => {
  it('declares eight variables, requires only EMAIL_TRANSPORT and EMAIL_FROM, and defaults EMAIL_RESEND_BASE_URL with an empty string counting as unset', async () => {
    const { emailEnvSchemaFragment } = await loadHearthkitEmailEntry()
    expect(Object.keys(emailEnvSchemaFragment.shape).toSorted()).toEqual([
      ...everyEmailVariableName,
    ])

    // Every per-transport variable is optional in the fragment on purpose: a flat object cannot say
    // "required when EMAIL_TRANSPORT is smtp", which is why resolveEmailTransportConfig exists.
    const nothingSet = expectResultKind(
      loadHearthkitConfig({ fragments: [emailEnvSchemaFragment], env: {} }),
      'config-validation-failed',
    )
    expect(nothingSet.message).toContain('EMAIL_TRANSPORT')
    expect(nothingSet.message).toContain('EMAIL_FROM')
    expect(nothingSet.issues).toHaveLength(2)
    for (const optionalVariableName of [
      'EMAIL_SMTP_HOST',
      'EMAIL_SMTP_PORT',
      'EMAIL_SMTP_USER',
      'EMAIL_SMTP_PASSWORD',
      'EMAIL_RESEND_API_KEY',
      'EMAIL_RESEND_BASE_URL',
    ]) {
      expect(nothingSet.message).not.toContain(optionalVariableName)
    }

    const baseUrlUnset = expectResultKind(
      loadHearthkitConfig({ fragments: [emailEnvSchemaFragment], env: completeSmtpEmailEnv }),
      'config-loaded',
    )
    expect(String(baseUrlUnset.config.EMAIL_RESEND_BASE_URL)).toBe(defaultResendBaseUrl)
    expect(String(baseUrlUnset.config.EMAIL_FROM)).toBe(completeSmtpEmailEnv.EMAIL_FROM)
    expect(String(baseUrlUnset.config.EMAIL_SMTP_HOST)).toBe(completeSmtpEmailEnv.EMAIL_SMTP_HOST)
    // Coerced from the environment's string value, so a caller never has to parse it again.
    expect(baseUrlUnset.config.EMAIL_SMTP_PORT).toBe(1025)
    expect(baseUrlUnset.config.EMAIL_SMTP_USER).toBeUndefined()

    const baseUrlEmpty = expectResultKind(
      loadHearthkitConfig({
        fragments: [emailEnvSchemaFragment],
        env: { ...completeSmtpEmailEnv, EMAIL_RESEND_BASE_URL: '' },
      }),
      'config-loaded',
    )
    expect(String(baseUrlEmpty.config.EMAIL_RESEND_BASE_URL)).toBe(defaultResendBaseUrl)

    const baseUrlChosen = expectResultKind(
      loadHearthkitConfig({
        fragments: [emailEnvSchemaFragment],
        env: { ...completeSmtpEmailEnv, EMAIL_RESEND_BASE_URL: 'http://127.0.0.1:53310' },
      }),
      'config-loaded',
    )
    expect(String(baseUrlChosen.config.EMAIL_RESEND_BASE_URL)).toBe('http://127.0.0.1:53310')
  })

  it('fails at load and names every variable whose value is not legal, including a Resend base URL carrying a path', async () => {
    const { emailEnvSchemaFragment } = await loadHearthkitEmailEntry()

    const failure = expectResultKind(
      loadHearthkitConfig({
        fragments: [emailEnvSchemaFragment],
        env: {
          EMAIL_TRANSPORT: 'sendgrid',
          // A newline in the From line is the header-injection vector the sender schema exists to stop.
          EMAIL_FROM: 'Hearthkit Gate <gate@hearthkit.test>\r\nBcc: attacker@example.test',
          EMAIL_SMTP_HOST: 'not a host name',
          EMAIL_SMTP_PORT: '70000',
          // A full endpoint path pasted into the origin is the mistake this schema catches at boot.
          EMAIL_RESEND_BASE_URL: 'https://api.resend.com/emails',
        },
      }),
      'config-validation-failed',
    )

    for (const variableName of [
      'EMAIL_TRANSPORT',
      'EMAIL_FROM',
      'EMAIL_SMTP_HOST',
      'EMAIL_SMTP_PORT',
      'EMAIL_RESEND_BASE_URL',
    ]) {
      expect(failure.message).toContain(variableName)
    }
    expect(failure.issues).toHaveLength(5)
  })
})

describe('@hearthkit/email entry point', () => {
  it('exports exactly the fifteen allowlisted values and nothing else, each schema the value email-contract.ts already exports', async () => {
    const namespace = await importHearthkitEmailNamespace()
    const contractModule = emailContract as unknown as Record<string, unknown>

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
    ).toEqual([...hearthkitEmailEntryValueExportNames].toSorted())

    // Split by origin: the ten schemas come from email-contract.ts, the three functions and the two
    // templates come from their own implementation modules. A schema renamed in the contract falls out
    // of the first group and fails the second assertion by name, so neither check can go quiet.
    const fromTheContractModule = hearthkitEmailEntryValueExportNames.filter(
      (exportName) => contractModule[exportName] !== undefined,
    )
    const fromAnImplementationModule = hearthkitEmailEntryValueExportNames.filter(
      (exportName) => contractModule[exportName] === undefined,
    )

    const rebuiltInsteadOfReExported = fromTheContractModule.filter(
      (exportName) => namespace[exportName] !== contractModule[exportName],
    )
    expect(
      rebuiltInsteadOfReExported,
      'these must be the identical value email-contract.ts exports, not a second copy of it',
    ).toEqual([])

    // The two templates are objects, so they are checked against the contract's own template schema
    // rather than by typeof; everything else email-contract.ts does not export is a public function.
    const notAFunctionOrATemplate = fromAnImplementationModule.filter((exportName) =>
      exportName === 'magicLinkEmailTemplate' || exportName === 'passwordResetEmailTemplate'
        ? !transactionalEmailTemplateSchema.safeParse(namespace[exportName]).success
        : typeof namespace[exportName] !== 'function',
    )
    expect(
      notAFunctionOrATemplate,
      'every allowlisted name email-contract.ts does not export must be one of the three functions or the two templates',
    ).toEqual([])
  })

  it('publishes ./email-contract as a second subpath carrying the ten schemas, loadable by a bare node process without touching a template', async () => {
    const manifest = await readEmailPackageManifest()
    expect(manifest.packageName).toBe('@hearthkit/email')
    expect(Object.keys(manifest.exportsMap).toSorted()).toEqual(['.', './email-contract'])
    expect(JSON.stringify(manifest.exportsMap['./email-contract'])).toContain(
      './src/email-contract-entry.ts',
    )

    const subpathNamespace = await importHearthkitEmailContractSubpathNamespace()
    const contractModule = emailContract as unknown as Record<string, unknown>
    const subpathValueExportNames = Object.keys(subpathNamespace)
      .filter((exportName) => subpathNamespace[exportName] !== undefined)
      .toSorted()
    expect(
      subpathValueExportNames,
      'src/email-contract-entry.ts must export exactly the ten allowlisted names that live in email-contract.ts',
    ).toEqual([...hearthkitEmailContractSubpathValueExportNames].toSorted())

    const rebuiltInsteadOfReExported = hearthkitEmailContractSubpathValueExportNames.filter(
      (exportName) => subpathNamespace[exportName] !== contractModule[exportName],
    )
    expect(
      rebuiltInsteadOfReExported,
      'these must be the identical value email-contract.ts exports, not a second copy of it',
    ).toEqual([])

    // The reason the subpath exists: the `.` entry transitively imports .tsx template modules, which
    // bare node refuses, while these files import zod and a type-only react specifier and must run.
    const bareNodeRun = await runEmailContractUnderBareNode()
    expect(bareNodeRun.exitCode, bareNodeRun.standardError).toBe(0)
  })
})
