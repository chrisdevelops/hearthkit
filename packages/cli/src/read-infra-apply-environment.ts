import {
  cloudflareApiTokenEnvVariableName,
  infraApplyRequiredEnvVariableNameSchema,
  infraProviderEnvVariableName,
  infraProviderNameSchema,
  tofuStateAccessKeyIdEnvVariableName,
  tofuStatePassphraseEnvVariableName,
  tofuStatePassphraseMinimumLength,
  tofuStateSecretAccessKeyEnvVariableName,
  type InfraApplyRequiredEnvVariableName,
  type InfraProviderName,
} from './cli-contract.ts'
import { readEnvironmentVariableValue } from './read-environment-variable-value.ts'

/**
 * The two environment checks hearthkit infra apply runs before anything else, kept apart from the
 * command so they stay readable as what they are: refusals that happen before a tofu process exists.
 *
 * Nothing here reads process.env. Every value comes from the environment the caller handed
 * runHearthkitCli, which is what lets a gate prove a refusal without touching the machine's own.
 */

/** Which provider module the environment selects, or the value that is not a provider this CLI has. */
export type InfraProviderSelection =
  | { kind: 'infra-provider-selected'; infraProviderName: InfraProviderName }
  | { kind: 'infra-provider-unsupported'; providerValue: string | undefined }

/** The four secret values a tofu run needs, or every variable that is unset, empty or too short. */
export type InfraApplySecretsRead =
  | { kind: 'infra-apply-secrets-read'; secrets: InfraApplySecretValues }
  | {
      kind: 'infra-apply-secrets-missing'
      missingVariableNames: InfraApplyRequiredEnvVariableName[]
      detail: string
    }

/** The four secrets, each named after the variable it came from; they reach child environments only. */
export type InfraApplySecretValues = {
  cloudflareApiToken: string
  tofuStateAccessKeyId: string
  tofuStateSecretAccessKey: string
  tofuStatePassphrase: string
}

/** Reads HEARTHKIT_INFRA_PROVIDER; empty counts as unset, and unset reports no value because there is none. */
export function readInfraProviderSelection(
  environmentVariables: Record<string, string | undefined>,
): InfraProviderSelection {
  const providerValue = readEnvironmentVariableValue(
    environmentVariables,
    infraProviderEnvVariableName,
  )
  const parsed = infraProviderNameSchema.safeParse(providerValue)
  if (!parsed.success) {
    return { kind: 'infra-provider-unsupported', providerValue }
  }
  return { kind: 'infra-provider-selected', infraProviderName: parsed.data }
}

/**
 * Reads the four secret variables together and reports every failing one at once, with the reason it
 * failed, so an operator fixes one shell export list instead of running the command four times.
 */
export function readInfraApplySecrets(
  environmentVariables: Record<string, string | undefined>,
): InfraApplySecretsRead {
  const readReasons = infraApplyRequiredEnvVariableNameSchema.options.map((variableName) => ({
    variableName,
    value: readEnvironmentVariableValue(environmentVariables, variableName),
  }))

  const failures = readReasons.flatMap(({ variableName, value }) => {
    if (value === undefined) {
      return [{ variableName, reason: 'is unset or empty' }]
    }
    if (
      variableName === tofuStatePassphraseEnvVariableName &&
      value.length < tofuStatePassphraseMinimumLength
    ) {
      return [
        {
          variableName,
          reason: `is shorter than ${String(tofuStatePassphraseMinimumLength)} characters, which the pbkdf2 key provider refuses`,
        },
      ]
    }
    return []
  })

  if (failures.length > 0) {
    return {
      kind: 'infra-apply-secrets-missing',
      missingVariableNames: failures.map((failure) => failure.variableName),
      detail: failures.map((failure) => `${failure.variableName} ${failure.reason}`).join('; '),
    }
  }

  return {
    kind: 'infra-apply-secrets-read',
    secrets: {
      cloudflareApiToken: requiredValueOf(environmentVariables, cloudflareApiTokenEnvVariableName),
      tofuStateAccessKeyId: requiredValueOf(
        environmentVariables,
        tofuStateAccessKeyIdEnvVariableName,
      ),
      tofuStateSecretAccessKey: requiredValueOf(
        environmentVariables,
        tofuStateSecretAccessKeyEnvVariableName,
      ),
      tofuStatePassphrase: requiredValueOf(
        environmentVariables,
        tofuStatePassphraseEnvVariableName,
      ),
    },
  }
}

/** Reads a variable the check above already proved present; the empty fallback is unreachable and keeps the type a string. */
function requiredValueOf(
  environmentVariables: Record<string, string | undefined>,
  variableName: string,
): string {
  return readEnvironmentVariableValue(environmentVariables, variableName) ?? ''
}
