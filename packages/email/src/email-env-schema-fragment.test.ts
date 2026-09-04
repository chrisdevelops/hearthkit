import { loadHearthkitConfig } from '@hearthkit/config'
import { describe, expect, it } from 'vitest'
import { expectResultKind } from '../test-fixtures/email-gate-expectations.ts'
import {
  readEmailPackageManifest,
  runEmailContractUnderBareNode,
} from '../test-fixtures/email-package-entry-points.ts'
import {
  importHearthkitEmailNamespace,
  loadHearthkitEmailEntry,
} from '../test-fixtures/hearthkit-email-entry.ts'
import * as emailContract from './email-contract.ts'
import { defaultResendBaseUrl } from './email-contract.ts'

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

// The rule packages/email/CONTRACT.md states for the entry point is mechanical: every value
// email-contract.ts exports is re-exported from src/index.ts, with no exceptions. So the required list
// is read off the contract module's own namespace rather than typed out here. A hand-written list
// would have to be extended by hand every time the contract grows an export, and would silently fall
// behind the day someone forgot; a derived list cannot.
//
// A module namespace carries value exports only. Every `export type` in email-contract.ts is erased
// before this file runs, so the types CONTRACT.md also asks the entry point to re-export are outside
// what this gate can see and are covered by typecheck instead.
function contractValueExportNames(contractModule: Record<string, unknown>): string[] {
  return Object.keys(contractModule).toSorted()
}

// CONTRACT.md names these in so many words: the six message-prefix constants and the six result
// schemas a caller needs to validate a narrowed result. They are spelled out as strings so that
// renaming one in the contract fails this gate loudly, instead of quietly shrinking the derived list
// to a set an entry point already satisfies.
const contractExportNamesTheContractNamesOutright = [
  'emailTransportConfigIncompleteErrorPrefix',
  'emailRecipientInvalidErrorPrefix',
  'emailTemplateRenderFailedErrorPrefix',
  'emailTransportUnreachableErrorPrefix',
  'emailTransportRejectedErrorPrefix',
  'emailSendFailedErrorPrefix',
  'emailEnvSchemaFragment',
  'emailFailureSchema',
  'emailTransportConfigResolvedSchema',
  'transactionalEmailRenderedSchema',
  'transactionalEmailSentSchema',
  'resolveEmailTransportConfigResultSchema',
  'renderTransactionalEmailResultSchema',
  'sendTransactionalEmailResultSchema',
] as const

// Not exported by email-contract.ts, so the derived list above cannot cover them.
const entryPointOnlyExportNames = [
  'resolveEmailTransportConfig',
  'renderTransactionalEmail',
  'sendTransactionalEmail',
  'magicLinkEmailTemplate',
  'passwordResetEmailTemplate',
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
  it('re-exports by name every value email-contract.ts exports, plus the three functions and the two templates', async () => {
    const namespace = await importHearthkitEmailNamespace()
    const contractModule = emailContract as unknown as Record<string, unknown>
    const requiredExportNames = contractValueExportNames(contractModule)

    const renamedInTheContract = contractExportNamesTheContractNamesOutright.filter(
      (exportName) => !requiredExportNames.includes(exportName),
    )
    expect(
      renamedInTheContract,
      'email-contract.ts must still export the constants and schemas CONTRACT.md names outright',
    ).toEqual([])

    // Both lists are compared whole rather than one name at a time, so a failure names every export
    // that is wrong instead of stopping at the first and hiding the rest behind a rerun.
    const missingFromTheEntryPoint = requiredExportNames.filter(
      (exportName) => namespace[exportName] === undefined,
    )
    expect(
      missingFromTheEntryPoint,
      'src/index.ts must re-export these by name from email-contract.ts',
    ).toEqual([])

    const rebuiltInsteadOfReExported = requiredExportNames.filter(
      (exportName) => namespace[exportName] !== contractModule[exportName],
    )
    expect(
      rebuiltInsteadOfReExported,
      'these must be the identical value email-contract.ts exports, not a second copy of it',
    ).toEqual([])

    const missingImplementationExports = entryPointOnlyExportNames.filter(
      (exportName) => namespace[exportName] === undefined,
    )
    expect(
      missingImplementationExports,
      'src/index.ts must re-export the public functions and the shipped templates by name',
    ).toEqual([])
  })

  it('publishes ./email-contract as a second subpath that a bare node process can load without touching a template', async () => {
    const manifest = await readEmailPackageManifest()
    expect(manifest.packageName).toBe('@hearthkit/email')
    expect(Object.keys(manifest.exportsMap).toSorted()).toEqual(['.', './email-contract'])
    expect(JSON.stringify(manifest.exportsMap['./email-contract'])).toContain(
      './src/email-contract.ts',
    )

    // The reason the subpath exists: the `.` entry transitively imports .tsx template modules, which
    // bare node refuses, while this file imports zod and a type-only react specifier and must run.
    const bareNodeRun = await runEmailContractUnderBareNode()
    expect(bareNodeRun.exitCode, bareNodeRun.standardError).toBe(0)
  })
})
