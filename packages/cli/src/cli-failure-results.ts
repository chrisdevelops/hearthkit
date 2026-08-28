import type { DbFailure } from '@hearthkit/db'
import {
  cliAdminUrlInvalidErrorPrefix,
  cliComposeFileUnwritableErrorPrefix,
  cliDatabaseUrlInvalidErrorPrefix,
  cliDatabaseUrlMissingErrorPrefix,
  cliDockerUnavailableErrorPrefix,
  cliDoctorFailedErrorPrefix,
  cliInfraComposeFailedErrorPrefix,
  cliNextDevUnavailableErrorPrefix,
  cliProjectManifestMissingErrorPrefix,
  cliUsageErrorPrefix,
  type CliFailure,
  type DoctorCheckName,
  type DoctorCheckResult,
} from './cli-contract.js'

/** Every failure this package returns is built here, so each message keeps its unique literal prefix in one place. */
type CliFailureOf<TKind extends CliFailure['kind']> = Extract<CliFailure, { kind: TKind }>

/** How many characters of a compose stderr stream travel back in the failure; enough to name the cause, short enough to print. */
const composeStandardErrorExcerptLimit = 2000

/** Unknown command, unknown flag, missing argument, or an argument that fails its schema; the only exit-2 failure. */
export function cliUsageInvalidFailure(detail: string): CliFailureOf<'cli-usage-invalid'> {
  return {
    kind: 'cli-usage-invalid',
    message: `${cliUsageErrorPrefix} ${detail}`,
  }
}

/** The admin URL resolved from the flag or the environment is not a postgres(ql) URL, so no database work was attempted. */
export function adminDatabaseUrlInvalidFailure(
  detail: string,
): CliFailureOf<'admin-database-url-invalid'> {
  return {
    kind: 'admin-database-url-invalid',
    message: `${cliAdminUrlInvalidErrorPrefix} ${detail}`,
  }
}

/** db migrate ran with neither --database-url nor DATABASE_URL; the message names the variable right after the prefix. */
export function databaseUrlMissingFailure(detail: string): CliFailureOf<'database-url-missing'> {
  return {
    kind: 'database-url-missing',
    message: `${cliDatabaseUrlMissingErrorPrefix} DATABASE_URL ${detail}`,
  }
}

/** The project-scoped database URL given on the command line or in the environment is not a postgres(ql) URL. */
export function databaseUrlInvalidFailure(detail: string): CliFailureOf<'database-url-invalid'> {
  return {
    kind: 'database-url-invalid',
    message: `${cliDatabaseUrlInvalidErrorPrefix} ${detail}`,
  }
}

/** Carries a @hearthkit/db failure out unchanged; the CLI never re-words it, so the db prefix stays greppable. */
export function dbCommandFailedFailure(dbFailure: DbFailure): CliFailureOf<'db-command-failed'> {
  return {
    kind: 'db-command-failed',
    dbFailure,
    message: dbFailure.message,
  }
}

/** docker is not on PATH, or it is but the daemon did not answer docker info. */
export function dockerUnavailableFailure(detail: string): CliFailureOf<'docker-unavailable'> {
  return {
    kind: 'docker-unavailable',
    message: `${cliDockerUnavailableErrorPrefix} ${detail}`,
  }
}

/** A docker compose invocation exited nonzero; the excerpt is compose's own words, truncated to stay printable. */
export function infraComposeFailedFailure(options: {
  composeArguments: readonly string[]
  composeExitCode: number
  composeStandardError: string
}): CliFailureOf<'infra-compose-failed'> {
  const reportedText = options.composeStandardError.trim()
  const composeStderrExcerpt = (
    reportedText === '' ? 'docker compose produced no diagnostic output' : reportedText
  ).slice(0, composeStandardErrorExcerptLimit)
  return {
    kind: 'infra-compose-failed',
    composeExitCode: options.composeExitCode,
    composeStderrExcerpt,
    message: `${cliInfraComposeFailedErrorPrefix} docker compose ${options.composeArguments.join(' ')} exited ${options.composeExitCode}: ${composeStderrExcerpt}`,
  }
}

/** Compose generation was needed but the working directory holds no package.json to read the services from. */
export function projectManifestMissingFailure(
  manifestPath: string,
  detail: string,
): CliFailureOf<'project-manifest-missing'> {
  return {
    kind: 'project-manifest-missing',
    manifestPath,
    message: `${cliProjectManifestMissingErrorPrefix} ${manifestPath} ${detail}`,
  }
}

/** The generated docker-compose.yml could not be written, so nothing was started. */
export function composeFileUnwritableFailure(
  composeFilePath: string,
  detail: string,
): CliFailureOf<'compose-file-unwritable'> {
  return {
    kind: 'compose-file-unwritable',
    composeFilePath,
    message: `${cliComposeFileUnwritableErrorPrefix} ${composeFilePath} ${detail}`,
  }
}

/** hearthkit dev found no runnable next binary in the project's node_modules/.bin. */
export function nextDevUnavailableFailure(detail: string): CliFailureOf<'next-dev-unavailable'> {
  return {
    kind: 'next-dev-unavailable',
    message: `${cliNextDevUnavailableErrorPrefix} ${detail}`,
  }
}

/** At least one doctor check did not pass; the whole report travels with the failure and still prints. */
export function doctorChecksFailedFailure(
  checks: DoctorCheckResult[],
  failedCheckNames: DoctorCheckName[],
): CliFailureOf<'doctor-checks-failed'> {
  return {
    kind: 'doctor-checks-failed',
    checks,
    failedCheckNames,
    message: `${cliDoctorFailedErrorPrefix} ${failedCheckNames.join(', ')}`,
  }
}
