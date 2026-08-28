import { localInfraServiceNameSchema, type LocalInfraServiceName } from './cli-contract.js'
import type { CliRuntimeContext } from './cli-runtime-context.js'
import { runChildProcessCommand, type ChildProcessOutcome } from './run-child-process-command.js'

/** Whether docker can be used at all right now: on PATH and with a daemon that answers. */
export type DockerAvailability =
  | { kind: 'docker-available'; serverVersion: string }
  | { kind: 'docker-unavailable'; detail: string }

/** A wedged daemon should report rather than hang the CLI, so the availability probe is bounded. */
const dockerProbeTimeoutMilliseconds = 30_000

/** How long docker compose up may spend waiting for services to be running or healthy before it gives up. */
const composeWaitTimeoutSeconds = 90

/** How much of a failed docker probe's own words to keep when explaining why docker is unusable. */
const dockerProbeDetailLimit = 400

/**
 * Probes docker the way the contract defines availability: the executable resolves on the caller's
 * PATH and `docker info` exits zero. Both halves are one question, because a CLI without a daemon
 * is just as unusable as no CLI at all.
 */
export async function checkDockerAvailability(
  context: CliRuntimeContext,
): Promise<DockerAvailability> {
  const outcome = await runChildProcessCommand({
    commandName: 'docker',
    commandArguments: ['info', '--format', '{{.ServerVersion}}'],
    context,
    timeoutMilliseconds: dockerProbeTimeoutMilliseconds,
  })

  if (outcome.kind === 'child-process-not-on-path') {
    return {
      kind: 'docker-unavailable',
      detail: 'docker was not found on PATH; install Docker Desktop or the docker engine',
    }
  }

  if (outcome.exitCode !== 0) {
    return {
      kind: 'docker-unavailable',
      detail: `docker info exited ${outcome.exitCode}; the daemon is not running (${outcome.standardError.trim().slice(0, dockerProbeDetailLimit)})`,
    }
  }

  return { kind: 'docker-available', serverVersion: outcome.standardOutput.trim() }
}

/**
 * Runs one docker compose subcommand against an explicit file, so which compose file is in play is
 * never guessed from the directory. Compose's stderr is forwarded live because pulls and health
 * waits are slow enough that silence looks like a hang.
 */
export async function runDockerComposeCommand(options: {
  context: CliRuntimeContext
  composeFilePath: string
  composeArguments: readonly string[]
  forwardStandardError?: boolean
}): Promise<ChildProcessOutcome> {
  return runChildProcessCommand({
    commandName: 'docker',
    commandArguments: ['compose', '--file', options.composeFilePath, ...options.composeArguments],
    context: options.context,
    forwardStandardError: options.forwardStandardError,
  })
}

/** The arguments that start every service in the file and wait for it to be running or healthy. */
export const composeUpArguments = [
  'up',
  '--detach',
  '--wait',
  '--wait-timeout',
  String(composeWaitTimeoutSeconds),
] as const

/** The arguments that stop and remove the file's services while keeping their named volumes. */
export const composeDownArguments = ['down'] as const

/** The arguments that list the services the file declares, whether or not hearthkit generated it. */
export const composeServicesArguments = ['config', '--services'] as const

/**
 * Keeps only the services this package knows how to run. A hand-written compose file naming its own
 * services therefore reports an empty list even though compose did start them, which is what the
 * contract says startedInfraServices means.
 */
export function readKnownInfraServiceNames(composeServicesOutput: string): LocalInfraServiceName[] {
  const declaredServiceNames = new Set(
    composeServicesOutput
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== ''),
  )
  return localInfraServiceNameSchema.options.filter((serviceName) =>
    declaredServiceNames.has(serviceName),
  )
}
