import type {
  EmailEnvValues,
  ResolveEmailTransportConfigOptions,
  ResolveEmailTransportConfigResult,
} from './email-contract.ts'
import { emailTransportConfigIncompleteFailure } from './email-failure-results.ts'

// Every variable name this resolver can report, written out rather than built from a prefix, so a
// search for the name an operator saw in the failure lands on this file.
const smtpHostVariableName = 'EMAIL_SMTP_HOST'
const smtpPortVariableName = 'EMAIL_SMTP_PORT'
const smtpUserVariableName = 'EMAIL_SMTP_USER'
const smtpPasswordVariableName = 'EMAIL_SMTP_PASSWORD'
const resendApiKeyVariableName = 'EMAIL_RESEND_API_KEY'

// Names every variable the SMTP transport still needs, in one pass, because reporting only the first
// makes an operator restart the process once per missing variable.
function missingSmtpVariableNames(emailEnv: EmailEnvValues): string[] {
  const missingVariableNames: string[] = []
  if (emailEnv.EMAIL_SMTP_HOST === undefined) {
    missingVariableNames.push(smtpHostVariableName)
  }
  if (emailEnv.EMAIL_SMTP_PORT === undefined) {
    missingVariableNames.push(smtpPortVariableName)
  }
  if (emailEnv.EMAIL_SMTP_USER !== undefined && emailEnv.EMAIL_SMTP_PASSWORD === undefined) {
    missingVariableNames.push(smtpPasswordVariableName)
  }
  if (emailEnv.EMAIL_SMTP_PASSWORD !== undefined && emailEnv.EMAIL_SMTP_USER === undefined) {
    missingVariableNames.push(smtpUserVariableName)
  }
  return missingVariableNames
}

function resolveSmtpEmailTransport(emailEnv: EmailEnvValues): ResolveEmailTransportConfigResult {
  const missingVariableNames = missingSmtpVariableNames(emailEnv)
  const smtpHostName = emailEnv.EMAIL_SMTP_HOST
  const smtpPortNumber = emailEnv.EMAIL_SMTP_PORT
  if (
    missingVariableNames.length > 0 ||
    smtpHostName === undefined ||
    smtpPortNumber === undefined
  ) {
    return emailTransportConfigIncompleteFailure('smtp', missingVariableNames)
  }

  const smtpUserName = emailEnv.EMAIL_SMTP_USER
  const smtpPassword = emailEnv.EMAIL_SMTP_PASSWORD
  return {
    kind: 'email-transport-config-resolved',
    emailTransportConfig: {
      kind: 'smtp-email-transport',
      emailFrom: emailEnv.EMAIL_FROM,
      smtpHostName,
      smtpPortNumber,
      // Absent as a whole rather than half-filled: the pair is unrepresentable any other way.
      smtpCredentials:
        smtpUserName === undefined || smtpPassword === undefined
          ? undefined
          : { smtpUserName, smtpPassword },
    },
  }
}

function resolveResendEmailTransport(emailEnv: EmailEnvValues): ResolveEmailTransportConfigResult {
  const resendApiKey = emailEnv.EMAIL_RESEND_API_KEY
  if (resendApiKey === undefined) {
    return emailTransportConfigIncompleteFailure('resend', [resendApiKeyVariableName])
  }

  return {
    kind: 'email-transport-config-resolved',
    emailTransportConfig: {
      kind: 'resend-email-transport',
      emailFrom: emailEnv.EMAIL_FROM,
      resendApiKey,
      // Always present, because the fragment defaults it, which is what keeps this arm gateable offline.
      resendBaseUrl: emailEnv.EMAIL_RESEND_BASE_URL,
    },
  }
}

/**
 * Narrows the flat validated environment into the transport union, naming every missing variable at
 * once. Synchronous, contacts nothing, never throws: run it immediately after config loads so a
 * half-built transport fails the process at boot rather than on the first user's sign-in request.
 */
export function resolveEmailTransportConfig(
  options: ResolveEmailTransportConfigOptions,
): ResolveEmailTransportConfigResult {
  // Variables belonging to the transport that was not selected are ignored, never an error, because a
  // local .env routinely carries both sets.
  if (options.emailEnv.EMAIL_TRANSPORT === 'smtp') {
    return resolveSmtpEmailTransport(options.emailEnv)
  }
  return resolveResendEmailTransport(options.emailEnv)
}
