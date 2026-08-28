import { postgresConnectionStringSchema, type PostgresConnectionString } from '@hearthkit/db'
import {
  adminDatabaseUrlEnvVariableName,
  defaultLocalAdminDatabaseUrl,
  type CliFailure,
} from './cli-contract.js'
import { adminDatabaseUrlInvalidFailure } from './cli-failure-results.js'
import { readEnvironmentVariableValue } from './read-environment-variable-value.js'

/** Where the admin connection came from, kept on the resolution so a failure can name the source the operator must fix. */
export type AdminDatabaseUrlSource = 'flag' | 'environment' | 'default'

/** A resolved admin connection, or the failure to report when the winning candidate is not a postgres(ql) URL. */
export type AdminDatabaseUrlResolution =
  | {
      kind: 'admin-database-url-resolved'
      adminDatabaseUrl: PostgresConnectionString
      adminDatabaseUrlSource: AdminDatabaseUrlSource
    }
  | {
      kind: 'admin-database-url-rejected'
      failure: Extract<CliFailure, { kind: 'admin-database-url-invalid' }>
    }

/**
 * Applies the contract's precedence: --admin-database-url, then HEARTHKIT_ADMIN_DATABASE_URL, then
 * the local compose default. Only the winning candidate is validated, so a broken environment
 * variable cannot spoil a run that passed the flag.
 */
export function resolveAdminDatabaseUrl(options: {
  adminDatabaseUrlFlagValue: string | undefined
  environmentVariables: Record<string, string | undefined>
}): AdminDatabaseUrlResolution {
  const environmentValue = readEnvironmentVariableValue(
    options.environmentVariables,
    adminDatabaseUrlEnvVariableName,
  )

  const candidate =
    options.adminDatabaseUrlFlagValue !== undefined
      ? { value: options.adminDatabaseUrlFlagValue, source: 'flag' as const }
      : environmentValue !== undefined
        ? { value: environmentValue, source: 'environment' as const }
        : { value: defaultLocalAdminDatabaseUrl as string, source: 'default' as const }

  const parsed = postgresConnectionStringSchema.safeParse(candidate.value)
  if (!parsed.success) {
    return {
      kind: 'admin-database-url-rejected',
      failure: adminDatabaseUrlInvalidFailure(
        `${describeAdminDatabaseUrlSource(candidate.source)} is not a postgres:// or postgresql:// url (given: ${candidate.value})`,
      ),
    }
  }

  return {
    kind: 'admin-database-url-resolved',
    adminDatabaseUrl: parsed.data,
    adminDatabaseUrlSource: candidate.source,
  }
}

/** Names the losing source in operator words, so the message says which knob to turn. */
function describeAdminDatabaseUrlSource(source: AdminDatabaseUrlSource): string {
  if (source === 'flag') {
    return '--admin-database-url'
  }
  if (source === 'environment') {
    return adminDatabaseUrlEnvVariableName
  }
  return 'the default local admin url'
}
