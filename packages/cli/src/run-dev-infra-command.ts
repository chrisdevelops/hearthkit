import type { CliCommandResult, CliFailure } from './cli-contract.ts'
import { dockerUnavailableFailure, infraComposeFailedFailure } from './cli-failure-results.ts'
import type { CliRuntimeContext } from './cli-runtime-context.ts'
import {
  checkDockerAvailability,
  composeDownArguments,
  composeServicesArguments,
  composeUpArguments,
  readKnownInfraServiceNames,
  runDockerComposeCommand,
} from './docker-compose-commands.ts'
import type { ChildProcessOutcome } from './run-child-process-command.ts'
import {
  hasLocalInfraComposeFile,
  localInfraComposeFilePath,
  resolveLocalInfraComposeFile,
} from './resolve-local-infra-compose-file.ts'

/**
 * Starts the project's local infra. Docker is checked before anything is read or written, then the
 * compose file is resolved (used as found, or generated from package.json), then compose runs. A
 * project that needs no local services succeeds having started nothing and written nothing.
 */
export async function runDevInfraUpCommand(context: CliRuntimeContext): Promise<CliCommandResult> {
  const availability = await checkDockerAvailability(context)
  if (availability.kind === 'docker-unavailable') {
    return dockerUnavailableFailure(availability.detail)
  }

  const resolution = await resolveLocalInfraComposeFile(context)
  if (resolution.kind === 'local-infra-compose-rejected') {
    return resolution.failure
  }
  if (resolution.kind === 'local-infra-compose-not-needed') {
    return { kind: 'dev-infra-up-succeeded', startedInfraServices: [] }
  }

  const upOutcome = await runDockerComposeCommand({
    context,
    composeFilePath: resolution.composeFilePath,
    composeArguments: composeUpArguments,
    forwardStandardError: true,
  })
  const upFailure = readComposeCommandFailure(upOutcome, composeUpArguments)
  if (upFailure !== undefined) {
    return upFailure
  }

  const servicesOutcome = await runDockerComposeCommand({
    context,
    composeFilePath: resolution.composeFilePath,
    composeArguments: composeServicesArguments,
  })
  const servicesFailure = readComposeCommandFailure(servicesOutcome, composeServicesArguments)
  if (servicesFailure !== undefined) {
    return servicesFailure
  }

  return {
    kind: 'dev-infra-up-succeeded',
    startedInfraServices:
      servicesOutcome.kind === 'child-process-exited'
        ? readKnownInfraServiceNames(servicesOutcome.standardOutput)
        : [],
  }
}

/**
 * Stops the project's local infra, keeping named volumes so data survives. A working directory with
 * no compose file has nothing to stop, and that is a success that never needs docker at all.
 */
export async function runDevInfraDownCommand(
  context: CliRuntimeContext,
): Promise<CliCommandResult> {
  if (!(await hasLocalInfraComposeFile(context))) {
    return { kind: 'dev-infra-down-succeeded' }
  }

  const availability = await checkDockerAvailability(context)
  if (availability.kind === 'docker-unavailable') {
    return dockerUnavailableFailure(availability.detail)
  }

  const downOutcome = await runDockerComposeCommand({
    context,
    composeFilePath: localInfraComposeFilePath(context),
    composeArguments: composeDownArguments,
    forwardStandardError: true,
  })
  const downFailure = readComposeCommandFailure(downOutcome, composeDownArguments)
  if (downFailure !== undefined) {
    return downFailure
  }

  return { kind: 'dev-infra-down-succeeded' }
}

/** Turns a compose invocation that did not work into the matching failure, or undefined when it did. */
function readComposeCommandFailure(
  outcome: ChildProcessOutcome,
  composeArguments: readonly string[],
): CliFailure | undefined {
  if (outcome.kind === 'child-process-not-on-path') {
    return dockerUnavailableFailure('docker left PATH between the availability check and this call')
  }
  if (outcome.exitCode !== 0) {
    return infraComposeFailedFailure({
      composeArguments,
      composeExitCode: outcome.exitCode,
      composeStandardError:
        outcome.standardError.trim() === '' ? outcome.standardOutput : outcome.standardError,
    })
  }
  return undefined
}
