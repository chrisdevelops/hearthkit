import { createDrizzleClient, postgresConnectionStringSchema } from '@hearthkit/db'
import {
  adminDatabaseUrlEnvVariableName,
  type CliCommandResult,
  type DoctorCheckName,
  type DoctorCheckResult,
} from './cli-contract.ts'
import { doctorChecksFailedFailure } from './cli-failure-results.ts'
import type { CliRuntimeContext } from './cli-runtime-context.ts'
import { readEnvironmentVariableValue } from './read-environment-variable-value.ts'
import { resolveAdminDatabaseUrl } from './resolve-admin-database-url.ts'
import { runChildProcessCommand } from './run-child-process-command.ts'

/** The Node major this stack is built and gated on; older majors are a fail, not a warning. */
const minimumNodeMajorVersion = 24

/** The Postgres client major @hearthkit/db shells out to; a v16 client shadowing v17 fails by design. */
const requiredPostgresClientMajorVersion = 17

/** Doctor is a diagnosis, not a wait: each probe gets a short leash so one hung tool cannot stall the report. */
const doctorProbeTimeoutMilliseconds = 20_000

/** The two variables this CLI reads; both are optional, and both must be postgres URLs when present. */
const cliEnvVariableNames = [adminDatabaseUrlEnvVariableName, 'DATABASE_URL'] as const

/**
 * Runs every doctor check and reports the whole set. Checks are independent except where one cannot
 * be answered without another (the docker daemon and compose plugin need the docker CLI), and those
 * are skipped rather than guessed. A skip counts as not-passed, exactly like a fail.
 */
export async function runDoctorCommand(context: CliRuntimeContext): Promise<CliCommandResult> {
  const dockerCliCheck = await readCommandAvailabilityCheck({
    checkName: 'docker-cli-available',
    commandName: 'docker',
    commandArguments: ['--version'],
    context,
  })
  const dockerCliUsable = dockerCliCheck.status === 'pass'

  const checks: DoctorCheckResult[] = [
    readNodeVersionCheck(),
    await readCommandAvailabilityCheck({
      checkName: 'pnpm-command-available',
      commandName: 'pnpm',
      commandArguments: ['--version'],
      context,
    }),
    dockerCliCheck,
    dockerCliUsable
      ? await readDockerDaemonCheck(context)
      : skippedCheck('docker-daemon-running', 'docker cli is not available'),
    dockerCliUsable
      ? await readComposePluginCheck(context)
      : skippedCheck('docker-compose-plugin-available', 'docker cli is not available'),
    await readPostgresClientToolsCheck(context),
    await readAdminDatabaseReachableCheck(context),
    readCliEnvVariablesCheck(context),
  ]

  const singleLineChecks = checks.map((check) => ({
    ...check,
    detail: collapseToSingleLine(check.detail),
  }))
  const failedCheckNames = singleLineChecks
    .filter((check) => check.status !== 'pass')
    .map((check) => check.checkName)

  if (failedCheckNames.length > 0) {
    return doctorChecksFailedFailure(singleLineChecks, failedCheckNames)
  }

  return { kind: 'doctor-report', checks: singleLineChecks, allDoctorChecksPassed: true }
}

/** Squeezes a detail onto one line, since a driver error or tool banner may arrive with newlines in it. */
function collapseToSingleLine(detail: string): string {
  return detail.replaceAll(/\s+/g, ' ').trim()
}

/** A check that could not be asked because the one it depends on failed; the detail names that reason. */
function skippedCheck(checkName: DoctorCheckName, reason: string): DoctorCheckResult {
  return { checkName, status: 'skip', detail: `not checked because ${reason}` }
}

/** The Node major running this process, which is the one that will run the app's scripts too. */
function readNodeVersionCheck(): DoctorCheckResult {
  const nodeMajorVersion = Number.parseInt(process.versions.node.split('.')[0] ?? '', 10)
  const supported = Number.isFinite(nodeMajorVersion) && nodeMajorVersion >= minimumNodeMajorVersion
  return {
    checkName: 'node-version-supported',
    status: supported ? 'pass' : 'fail',
    detail: supported
      ? `node v${process.versions.node} meets the required major ${minimumNodeMajorVersion}`
      : `node v${process.versions.node} is older than the required major ${minimumNodeMajorVersion}`,
  }
}

/** Whether one command answers on PATH, using its own version output as the detail. */
async function readCommandAvailabilityCheck(options: {
  checkName: DoctorCheckName
  commandName: string
  commandArguments: readonly string[]
  context: CliRuntimeContext
}): Promise<DoctorCheckResult> {
  const outcome = await runChildProcessCommand({
    commandName: options.commandName,
    commandArguments: options.commandArguments,
    context: options.context,
    timeoutMilliseconds: doctorProbeTimeoutMilliseconds,
  })

  if (outcome.kind === 'child-process-not-on-path') {
    return {
      checkName: options.checkName,
      status: 'fail',
      detail: `${options.commandName} was not found on PATH`,
    }
  }
  if (outcome.exitCode !== 0) {
    return {
      checkName: options.checkName,
      status: 'fail',
      detail: `${options.commandName} ${options.commandArguments.join(' ')} exited ${outcome.exitCode}: ${firstLineOf(outcome.standardError)}`,
    }
  }
  const versionLine = firstLineOf(outcome.standardOutput)
  return {
    checkName: options.checkName,
    status: 'pass',
    detail:
      versionLine === ''
        ? `${options.commandName} is on PATH`
        : nameVersionLine(options.commandName, versionLine),
  }
}

/** Keeps the tool's own version wording but makes sure the detail says which tool reported it. */
function nameVersionLine(commandName: string, versionLine: string): string {
  return versionLine.toLowerCase().includes(commandName.toLowerCase())
    ? versionLine
    : `${commandName} ${versionLine}`
}

/** Whether the docker daemon answers, which is a different question from whether the CLI is installed. */
async function readDockerDaemonCheck(context: CliRuntimeContext): Promise<DoctorCheckResult> {
  const outcome = await runChildProcessCommand({
    commandName: 'docker',
    commandArguments: ['info', '--format', '{{.ServerVersion}}'],
    context,
    timeoutMilliseconds: doctorProbeTimeoutMilliseconds,
  })

  if (outcome.kind === 'child-process-not-on-path') {
    return {
      checkName: 'docker-daemon-running',
      status: 'fail',
      detail: 'docker left PATH mid-report',
    }
  }
  if (outcome.exitCode !== 0) {
    return {
      checkName: 'docker-daemon-running',
      status: 'fail',
      detail: `docker info exited ${outcome.exitCode}; start Docker Desktop or the docker engine (${firstLineOf(outcome.standardError)})`,
    }
  }
  return {
    checkName: 'docker-daemon-running',
    status: 'pass',
    detail: `docker daemon is running, server version ${firstLineOf(outcome.standardOutput)}`,
  }
}

/** Whether the compose plugin is installed; hearthkit only ever calls compose as a docker subcommand. */
async function readComposePluginCheck(context: CliRuntimeContext): Promise<DoctorCheckResult> {
  return readCommandAvailabilityCheck({
    checkName: 'docker-compose-plugin-available',
    commandName: 'docker',
    commandArguments: ['compose', 'version'],
    context,
  })
}

/**
 * Whether pg_dump and pg_restore are both on PATH at the major @hearthkit/db needs. An older client
 * shadowing a newer server is the failure this catches: it reads fine and then writes archives the
 * server cannot restore.
 */
async function readPostgresClientToolsCheck(
  context: CliRuntimeContext,
): Promise<DoctorCheckResult> {
  const toolNames = ['pg_dump', 'pg_restore'] as const
  const details: string[] = []

  for (const toolName of toolNames) {
    const outcome = await runChildProcessCommand({
      commandName: toolName,
      commandArguments: ['--version'],
      context,
      timeoutMilliseconds: doctorProbeTimeoutMilliseconds,
    })

    if (outcome.kind === 'child-process-not-on-path') {
      return {
        checkName: 'postgres-client-tools-version',
        status: 'fail',
        detail: `${toolName} was not found on PATH; install the Postgres ${requiredPostgresClientMajorVersion} client tools`,
      }
    }
    if (outcome.exitCode !== 0) {
      return {
        checkName: 'postgres-client-tools-version',
        status: 'fail',
        detail: `${toolName} --version exited ${outcome.exitCode}: ${firstLineOf(outcome.standardError)}`,
      }
    }

    const versionText = firstLineOf(outcome.standardOutput)
    const majorVersion = readToolMajorVersion(versionText)
    if (majorVersion !== requiredPostgresClientMajorVersion) {
      return {
        checkName: 'postgres-client-tools-version',
        status: 'fail',
        detail: `${versionText} is not major ${requiredPostgresClientMajorVersion}; an older client on PATH shadows the one hearthkit needs`,
      }
    }
    details.push(versionText)
  }

  return {
    checkName: 'postgres-client-tools-version',
    status: 'pass',
    detail: details.join('; '),
  }
}

/** Whether the resolved admin connection answers a trivial query, using @hearthkit/db's own client. */
async function readAdminDatabaseReachableCheck(
  context: CliRuntimeContext,
): Promise<DoctorCheckResult> {
  const resolution = resolveAdminDatabaseUrl({
    adminDatabaseUrlFlagValue: undefined,
    environmentVariables: context.environmentVariables,
  })
  if (resolution.kind === 'admin-database-url-rejected') {
    return {
      checkName: 'admin-database-reachable',
      status: 'fail',
      detail: resolution.failure.message,
    }
  }

  const { drizzleClient, closeDatabaseClient } = createDrizzleClient({
    databaseUrl: resolution.adminDatabaseUrl,
  })
  try {
    await drizzleClient.execute('select 1')
    return {
      checkName: 'admin-database-reachable',
      status: 'pass',
      detail: `${redactConnectionPassword(resolution.adminDatabaseUrl)} answered select 1 (from ${resolution.adminDatabaseUrlSource})`,
    }
  } catch (error) {
    return {
      checkName: 'admin-database-reachable',
      status: 'fail',
      detail: `${redactConnectionPassword(resolution.adminDatabaseUrl)} did not answer select 1: ${describeQueryError(error)}`,
    }
  } finally {
    await closeDatabaseClient().catch(() => undefined)
  }
}

/** Whether the two variables this CLI reads hold postgres URLs; unset is a pass, since both are optional. */
function readCliEnvVariablesCheck(context: CliRuntimeContext): DoctorCheckResult {
  const invalidVariableNames = cliEnvVariableNames.filter((variableName) => {
    const value = readEnvironmentVariableValue(context.environmentVariables, variableName)
    return value !== undefined && !postgresConnectionStringSchema.safeParse(value).success
  })

  if (invalidVariableNames.length > 0) {
    return {
      checkName: 'cli-env-variables-valid',
      status: 'fail',
      detail: `${invalidVariableNames.join(', ')} is not a postgres:// or postgresql:// url`,
    }
  }

  const setVariableNames = cliEnvVariableNames.filter(
    (variableName) =>
      readEnvironmentVariableValue(context.environmentVariables, variableName) !== undefined,
  )
  return {
    checkName: 'cli-env-variables-valid',
    status: 'pass',
    detail:
      setVariableNames.length === 0
        ? `neither ${cliEnvVariableNames.join(' nor ')} is set, which is allowed`
        : `set and holding a postgres url: ${setVariableNames.join(', ')}`,
  }
}

/** A query error in one readable phrase; the driver's cause carries the refusal, the wrapper only says which query. */
function describeQueryError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const causeMessage =
    error instanceof Error && error.cause instanceof Error ? error.cause.message : ''
  return causeMessage === '' ? message : `${message} (${causeMessage})`
}

/** The major version in a tool's own version line, or null when it reports something unparseable. */
function readToolMajorVersion(versionText: string): number | null {
  const dottedMatch = /(\d+)(?:\.\d+)+/.exec(versionText)
  const bareMatch = dottedMatch ?? /(\d+)/.exec(versionText)
  const majorText = bareMatch?.[1]
  if (majorText === undefined) {
    return null
  }
  const majorVersion = Number.parseInt(majorText, 10)
  return Number.isFinite(majorVersion) ? majorVersion : null
}

/** Keeps a check detail to one line, since the report is a table. */
function firstLineOf(text: string): string {
  return text.trim().split('\n')[0]?.trim() ?? ''
}

/** Replaces the password in a connection URL so a printed report can be pasted into an issue. */
function redactConnectionPassword(connectionString: string): string {
  try {
    const url = new URL(connectionString)
    if (url.password !== '') {
      url.password = '***'
    }
    return url.toString()
  } catch {
    return connectionString
  }
}
