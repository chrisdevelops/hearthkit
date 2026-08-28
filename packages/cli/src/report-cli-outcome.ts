import {
  cliDbBackupCompleteLinePrefix,
  cliDbCreateCredentialsWarningPrefix,
  cliDbDropCompleteLinePrefix,
  cliDbMigrateCompleteLinePrefix,
  cliDbRestoreCompleteLinePrefix,
  cliDevInfraDownCompleteLinePrefix,
  cliDevInfraUpCompleteLinePrefix,
  type CliCommandInvocation,
  type CliCommandResult,
  type CliExitCode,
  type DoctorCheckResult,
} from './cli-contract.js'
import { writeStandardErrorLine, writeStandardOutputLine } from './cli-output-streams.js'
import { formatDoctorCheckTable, formatDoctorJsonReport } from './format-doctor-report.js'

/** Exit code for a command that did what it was asked. */
const successExitCode = 0

/** Exit code for a command that was understood but could not be carried out. */
const operationalFailureExitCode = 1

/** Exit code for a command line that could not be understood at all. */
const usageFailureExitCode = 2

/**
 * Writes everything one command run prints and returns the code the process should exit with. All
 * stream writes live here, so the single stdout line per command and the stderr-only failure rule
 * are enforced in one place rather than in every handler.
 */
export function reportCliOutcome(options: {
  result: CliCommandResult
  invocation: CliCommandInvocation | undefined
}): CliExitCode {
  const { result, invocation } = options

  switch (result.kind) {
    case 'db-create-command-succeeded':
      writeStandardErrorLine(
        `${cliDbCreateCredentialsWarningPrefix} the connection string below holds a generated password shown this once and never stored; copy it into your .env.local now`,
      )
      writeStandardOutputLine(result.connectionString)
      return successExitCode

    case 'db-drop-command-succeeded':
      writeStandardOutputLine(
        `${cliDbDropCompleteLinePrefix} ${result.projectDatabaseName} and its role are gone`,
      )
      return successExitCode

    case 'db-migrate-command-succeeded':
      writeStandardOutputLine(
        `${cliDbMigrateCompleteLinePrefix} applied ${result.appliedMigrationCount} migration(s)`,
      )
      return successExitCode

    case 'db-backup-command-succeeded':
      writeStandardOutputLine(
        `${cliDbBackupCompleteLinePrefix} ${result.projectDatabaseName} written to ${result.backupFilePath} (${result.backupByteCount} bytes)`,
      )
      return successExitCode

    case 'db-restore-command-succeeded':
      writeStandardOutputLine(
        `${cliDbRestoreCompleteLinePrefix} ${result.projectDatabaseName} restored from ${result.backupFilePath}`,
      )
      return successExitCode

    case 'dev-infra-up-succeeded':
      writeStandardOutputLine(
        `${cliDevInfraUpCompleteLinePrefix} ${
          result.startedInfraServices.length === 0
            ? 'no local infra services needed'
            : `started ${result.startedInfraServices.join(', ')}`
        }`,
      )
      return successExitCode

    case 'dev-infra-down-succeeded':
      writeStandardOutputLine(`${cliDevInfraDownCompleteLinePrefix} local infra services stopped`)
      return successExitCode

    // next dev already streamed its own stdio, so there is nothing left to print for it.
    case 'dev-command-exited':
      return result.nextDevExitCode

    case 'doctor-report':
      printDoctorReport(result.checks, true, readDoctorJsonOutput(invocation))
      return successExitCode

    case 'doctor-checks-failed':
      printDoctorReport(result.checks, false, readDoctorJsonOutput(invocation))
      writeStandardErrorLine(result.message)
      return operationalFailureExitCode

    case 'cli-usage-invalid':
      writeStandardErrorLine(result.message)
      return usageFailureExitCode

    default:
      writeStandardErrorLine(result.message)
      return operationalFailureExitCode
  }
}

/** Whether doctor was asked for JSON; any other command's invocation means the question does not apply. */
function readDoctorJsonOutput(invocation: CliCommandInvocation | undefined): boolean {
  return invocation !== undefined && invocation.commandPath === 'doctor' && invocation.jsonOutput
}

/** Prints the report on stdout in the shape the operator asked for, whether or not every check passed. */
function printDoctorReport(
  checks: DoctorCheckResult[],
  allDoctorChecksPassed: boolean,
  jsonOutput: boolean,
): void {
  writeStandardOutputLine(
    jsonOutput
      ? formatDoctorJsonReport({ checks, allDoctorChecksPassed })
      : formatDoctorCheckTable(checks),
  )
}
