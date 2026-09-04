import { describe, expect, it } from 'vitest'
import {
  expectContractStringExport,
  expectEmailFailure,
  expectResultKind,
} from '../test-fixtures/email-gate-expectations.ts'
import { loadHearthkitEmailEntry } from '../test-fixtures/hearthkit-email-entry.ts'
import {
  defaultResendBaseUrl,
  emailEnvSchemaFragment,
  resolveEmailTransportConfigResultSchema,
  type EmailEnvValues,
} from './email-contract.ts'

const gateEmailFrom = 'Hearthkit Gate <gate@hearthkit.test>'

// Every gate environment carries both transports' variables, because a local .env routinely does and
// the contract says the unselected transport's variables are ignored rather than validated.
function gateEmailEnv(overrides: Record<string, string>): EmailEnvValues {
  return emailEnvSchemaFragment.parse({ EMAIL_FROM: gateEmailFrom, ...overrides })
}

const everySmtpVariable = {
  EMAIL_SMTP_HOST: '127.0.0.1',
  EMAIL_SMTP_PORT: '1025',
  EMAIL_SMTP_USER: 'gate-smtp-user',
  EMAIL_SMTP_PASSWORD: 'gate-smtp-password-that-must-never-be-echoed',
}

const everyResendVariable = {
  EMAIL_RESEND_API_KEY: 're_gate_key_that_must_never_be_echoed',
  EMAIL_RESEND_BASE_URL: 'http://127.0.0.1:53310',
}

describe('resolveEmailTransportConfig', () => {
  it('resolves the SMTP transport with and without credentials, ignoring the Resend variables entirely', async () => {
    const { resolveEmailTransportConfig } = await loadHearthkitEmailEntry()

    const withoutCredentials = resolveEmailTransportConfig({
      emailEnv: gateEmailEnv({
        EMAIL_TRANSPORT: 'smtp',
        EMAIL_SMTP_HOST: '127.0.0.1',
        EMAIL_SMTP_PORT: '1025',
        ...everyResendVariable,
      }),
    })
    resolveEmailTransportConfigResultSchema.parse(withoutCredentials)
    const plain = expectResultKind(
      expectResultKind(withoutCredentials, 'email-transport-config-resolved').emailTransportConfig,
      'smtp-email-transport',
    )
    expect(String(plain.emailFrom)).toBe(gateEmailFrom)
    expect(String(plain.smtpHostName)).toBe('127.0.0.1')
    expect(plain.smtpPortNumber).toBe(1025)
    // Mailpit needs no credentials, and a half-filled pair is unrepresentable, so this is absent whole.
    expect(plain.smtpCredentials).toBeUndefined()

    const withCredentials = resolveEmailTransportConfig({
      emailEnv: gateEmailEnv({
        EMAIL_TRANSPORT: 'smtp',
        ...everySmtpVariable,
        ...everyResendVariable,
      }),
    })
    resolveEmailTransportConfigResultSchema.parse(withCredentials)
    const authenticated = expectResultKind(
      expectResultKind(withCredentials, 'email-transport-config-resolved').emailTransportConfig,
      'smtp-email-transport',
    )
    expect(String(authenticated.smtpCredentials?.smtpUserName)).toBe('gate-smtp-user')
    expect(String(authenticated.smtpCredentials?.smtpPassword)).toBe(
      everySmtpVariable.EMAIL_SMTP_PASSWORD,
    )
  })

  it('resolves the Resend transport, defaulting the base URL, ignoring the SMTP variables entirely', async () => {
    const { resolveEmailTransportConfig } = await loadHearthkitEmailEntry()

    const defaultedBaseUrl = resolveEmailTransportConfig({
      emailEnv: gateEmailEnv({
        EMAIL_TRANSPORT: 'resend',
        EMAIL_RESEND_API_KEY: everyResendVariable.EMAIL_RESEND_API_KEY,
        ...everySmtpVariable,
      }),
    })
    resolveEmailTransportConfigResultSchema.parse(defaultedBaseUrl)
    const defaulted = expectResultKind(
      expectResultKind(defaultedBaseUrl, 'email-transport-config-resolved').emailTransportConfig,
      'resend-email-transport',
    )
    expect(String(defaulted.emailFrom)).toBe(gateEmailFrom)
    expect(String(defaulted.resendApiKey)).toBe(everyResendVariable.EMAIL_RESEND_API_KEY)
    expect(String(defaulted.resendBaseUrl)).toBe(
      expectContractStringExport(defaultResendBaseUrl, 'defaultResendBaseUrl'),
    )

    const chosenBaseUrl = resolveEmailTransportConfig({
      emailEnv: gateEmailEnv({
        EMAIL_TRANSPORT: 'resend',
        ...everyResendVariable,
        ...everySmtpVariable,
      }),
    })
    const chosen = expectResultKind(
      expectResultKind(chosenBaseUrl, 'email-transport-config-resolved').emailTransportConfig,
      'resend-email-transport',
    )
    expect(String(chosen.resendBaseUrl)).toBe(everyResendVariable.EMAIL_RESEND_BASE_URL)
  })

  it('returns email-transport-config-incomplete naming every missing variable at once, not just the first', async () => {
    const { resolveEmailTransportConfig } = await loadHearthkitEmailEntry()

    const incompleteCases = [
      {
        label: 'smtp with neither host nor port',
        emailEnv: gateEmailEnv({ EMAIL_TRANSPORT: 'smtp', ...everyResendVariable }),
        emailTransportName: 'smtp',
        missingVariableNames: ['EMAIL_SMTP_HOST', 'EMAIL_SMTP_PORT'],
      },
      {
        label: 'smtp with a user and no password',
        emailEnv: gateEmailEnv({
          EMAIL_TRANSPORT: 'smtp',
          EMAIL_SMTP_HOST: '127.0.0.1',
          EMAIL_SMTP_PORT: '1025',
          EMAIL_SMTP_USER: 'gate-smtp-user',
        }),
        emailTransportName: 'smtp',
        missingVariableNames: ['EMAIL_SMTP_PASSWORD'],
      },
      {
        label: 'smtp with a password and no user',
        emailEnv: gateEmailEnv({
          EMAIL_TRANSPORT: 'smtp',
          EMAIL_SMTP_HOST: '127.0.0.1',
          EMAIL_SMTP_PORT: '1025',
          EMAIL_SMTP_PASSWORD: everySmtpVariable.EMAIL_SMTP_PASSWORD,
        }),
        emailTransportName: 'smtp',
        missingVariableNames: ['EMAIL_SMTP_USER'],
      },
      {
        // Three missing at once. A first-failure-only implementation reports one and fails here.
        label: 'smtp with nothing but a user name',
        emailEnv: gateEmailEnv({ EMAIL_TRANSPORT: 'smtp', EMAIL_SMTP_USER: 'gate-smtp-user' }),
        emailTransportName: 'smtp',
        missingVariableNames: ['EMAIL_SMTP_HOST', 'EMAIL_SMTP_PASSWORD', 'EMAIL_SMTP_PORT'],
      },
      {
        // The mistake people actually make: config succeeds, and this is where it is caught.
        label: 'resend with no API key',
        emailEnv: gateEmailEnv({ EMAIL_TRANSPORT: 'resend', ...everySmtpVariable }),
        emailTransportName: 'resend',
        missingVariableNames: ['EMAIL_RESEND_API_KEY'],
      },
    ] as const

    for (const incompleteCase of incompleteCases) {
      const result = resolveEmailTransportConfig({ emailEnv: incompleteCase.emailEnv })
      resolveEmailTransportConfigResultSchema.parse(result)
      const failure = expectEmailFailure(result, 'email-transport-config-incomplete')

      expect(failure.emailTransportName, incompleteCase.label).toBe(
        incompleteCase.emailTransportName,
      )
      expect(failure.missingVariableNames.toSorted(), incompleteCase.label).toEqual([
        ...incompleteCase.missingVariableNames,
      ])
      for (const variableName of incompleteCase.missingVariableNames) {
        expect(failure.message, incompleteCase.label).toContain(variableName)
      }
    }
  })
})
