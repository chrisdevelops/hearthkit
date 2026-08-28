import {
  cliFailureSchema,
  cliRunOutcomeSchema,
  type CliCommandSuccess,
  type CliFailure,
  type CliRunOutcome,
  type RunHearthkitCliOptions,
} from '../src/cli-contract.ts'
import { loadHearthkitCliEntry } from './hearthkit-cli-entry.ts'

/** One CLI run: the contract-validated outcome plus everything the command wrote to the two process streams. */
export type GateCliRun = {
  outcome: CliRunOutcome
  standardOutput: string
  standardError: string
}

/**
 * Collects process.stdout and process.stderr writes for the duration of one call. The CLI writes to
 * the real streams, so a gate that wants the printed line has to capture them rather than mock them.
 */
async function captureProcessOutput<TValue>(
  run: () => Promise<TValue>,
): Promise<{ value: TValue; standardOutput: string; standardError: string }> {
  const standardOutputChunks: string[] = []
  const standardErrorChunks: string[] = []
  const originalStandardOutputWrite = process.stdout.write.bind(process.stdout)
  const originalStandardErrorWrite = process.stderr.write.bind(process.stderr)

  process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
    standardOutputChunks.push(String(chunk))
    const callback = rest.find((argument) => typeof argument === 'function')
    if (typeof callback === 'function') {
      callback()
    }
    return true
  }) as typeof process.stdout.write
  process.stderr.write = ((chunk: unknown, ...rest: unknown[]) => {
    standardErrorChunks.push(String(chunk))
    const callback = rest.find((argument) => typeof argument === 'function')
    if (typeof callback === 'function') {
      callback()
    }
    return true
  }) as typeof process.stderr.write

  try {
    const value = await run()
    return {
      value,
      standardOutput: standardOutputChunks.join(''),
      standardError: standardErrorChunks.join(''),
    }
  } finally {
    process.stdout.write = originalStandardOutputWrite
    process.stderr.write = originalStandardErrorWrite
  }
}

/**
 * Runs one command through the package's public entry point and validates the returned outcome
 * against cliRunOutcomeSchema, so every gate checks the structured contract and not only the text.
 */
export async function runHearthkitCliGate(options: RunHearthkitCliOptions): Promise<GateCliRun> {
  const { runHearthkitCli } = await loadHearthkitCliEntry()
  const captured = await captureProcessOutput(() => runHearthkitCli(options))
  return {
    outcome: cliRunOutcomeSchema.parse(captured.value),
    standardOutput: captured.standardOutput,
    standardError: captured.standardError,
  }
}

/** Narrows any contract result to one variant, failing the gate with the whole result when it took another branch. */
function expectResultKind<TResult extends { kind: string }, TKind extends TResult['kind']>(
  result: TResult,
  expectedKind: TKind,
): Extract<TResult, { kind: TKind }> {
  if (result.kind !== expectedKind) {
    throw new Error(`gate expected ${expectedKind}, received ${JSON.stringify(result)}`)
  }
  return result as unknown as Extract<TResult, { kind: TKind }>
}

/** Asserts the run succeeded with one success variant and one exit code, returning the narrowed success. */
export function expectCliSuccess<TKind extends CliCommandSuccess['kind']>(
  run: GateCliRun,
  expectedKind: TKind,
  expectedExitCode: number,
): Extract<CliCommandSuccess, { kind: TKind }> {
  if (run.outcome.exitCode !== expectedExitCode) {
    throw new Error(
      `gate expected exit code ${expectedExitCode}, received ${run.outcome.exitCode} with ${JSON.stringify(run.outcome.result)} and stderr ${JSON.stringify(run.standardError)}`,
    )
  }
  return expectResultKind(run.outcome.result as CliCommandSuccess, expectedKind)
}

/**
 * Validates the returned result against the failure union, which also checks the unique message
 * prefix, then narrows it to one kind and asserts the exit code the contract pairs with it.
 */
export function expectCliFailure<TKind extends CliFailure['kind']>(
  run: GateCliRun,
  expectedKind: TKind,
  expectedExitCode: number,
): Extract<CliFailure, { kind: TKind }> {
  const parsed = cliFailureSchema.safeParse(run.outcome.result)
  if (!parsed.success) {
    throw new Error(
      `gate expected a ${expectedKind} failure matching cliFailureSchema, received ${JSON.stringify(run.outcome.result)}`,
    )
  }
  if (run.outcome.exitCode !== expectedExitCode) {
    throw new Error(
      `gate expected exit code ${expectedExitCode}, received ${run.outcome.exitCode} with ${JSON.stringify(run.outcome.result)}`,
    )
  }
  return expectResultKind(parsed.data, expectedKind)
}

/** The single stdout line a command printed, with the trailing newline removed; fails when the command printed more than one. */
export function singleStandardOutputLine(run: GateCliRun): string {
  const lines = run.standardOutput.split('\n').filter((line) => line.trim().length > 0)
  if (lines.length !== 1) {
    throw new Error(`gate expected exactly one stdout line, received ${JSON.stringify(lines)}`)
  }
  return lines[0] as string
}
