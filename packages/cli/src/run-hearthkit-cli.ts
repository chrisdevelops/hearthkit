import type { CliCommandInvocation, CliCommandResult, RunHearthkitCli } from './cli-contract.ts'
import type { CliRuntimeContext } from './cli-runtime-context.ts'
import { parseCliInvocation } from './parse-cli-invocation.ts'
import { reportCliOutcome } from './report-cli-outcome.ts'
import { runDbLifecycleCommand } from './run-db-lifecycle-command.ts'
import { runDevCommand } from './run-dev-command.ts'
import { runDevInfraDownCommand, runDevInfraUpCommand } from './run-dev-infra-command.ts'
import { runDoctorCommand } from './run-doctor-checks.ts'
import { runInfraApplyCommand } from './run-infra-apply-command.ts'
import { runPaymentsSyncCommand } from './run-payments-sync-command.ts'

/**
 * Runs one hearthkit command end to end: resolve the working directory and environment, parse argv,
 * hand the invocation to the package that owns the work, then print and score the outcome. Every
 * contract failure comes back as a result with an exit code; nothing here throws to report one.
 */
export const runHearthkitCli: RunHearthkitCli = async (options) => {
  const context: CliRuntimeContext = {
    workingDirectoryPath: options.cwd ?? process.cwd(),
    environmentVariables: options.env ?? process.env,
  }

  const parse = parseCliInvocation({ argv: options.argv, context })
  if (parse.kind === 'cli-invocation-rejected') {
    return {
      exitCode: reportCliOutcome({ result: parse.failure, invocation: undefined }),
      result: parse.failure,
    }
  }

  const result = await runCliCommandInvocation({ invocation: parse.invocation, context })
  return {
    exitCode: reportCliOutcome({ result, invocation: parse.invocation }),
    result,
  }
}

/** Dispatches a parsed invocation to the one handler that owns it; the switch is the whole command registry. */
async function runCliCommandInvocation(options: {
  invocation: CliCommandInvocation
  context: CliRuntimeContext
}): Promise<CliCommandResult> {
  const { invocation, context } = options

  if (invocation.commandPath === 'dev') {
    return runDevCommand(context)
  }
  if (invocation.commandPath === 'dev infra up') {
    return runDevInfraUpCommand(context)
  }
  if (invocation.commandPath === 'dev infra down') {
    return runDevInfraDownCommand(context)
  }
  if (invocation.commandPath === 'doctor') {
    return runDoctorCommand(context)
  }
  if (invocation.commandPath === 'payments sync') {
    return runPaymentsSyncCommand({ catalogPath: invocation.catalogPath, context })
  }
  if (invocation.commandPath === 'infra apply') {
    return runInfraApplyCommand(context)
  }
  // Everything left is a db command, and it has to be: a command path added to the enum without a
  // handler here fails to typecheck against DbLifecycleInvocation rather than falling through.
  return runDbLifecycleCommand({ invocation, context })
}
