// The pnpm create @hearthkit command itself. Reached through create-bin-entry.js, never named in
// the bin field directly, because Node refuses to strip types from a .ts file under node_modules
// and the entry shim is what installs the loader hook that does it. The relative imports below name
// .ts files because that is what actually ships: there is still no build step.
import { createHearthkitProject } from './create-hearthkit-project.ts'
import type { CreateFailure } from './create-contract.ts'
import { parseCreateBinArguments } from './parse-create-bin-arguments.ts'

/**
 * `pnpm create @hearthkit`. A thin wrapper: parse argv into the options object, call the function,
 * exit with the code its result implies. Every next-steps line is printed by the function itself, so
 * stdout carries them and stderr carries only the failure.
 */

/** The four failures a user caused by what they typed; everything else is an operational failure. */
const usageFailureKinds: readonly CreateFailure['kind'][] = [
  'create-option-missing',
  'create-project-name-invalid',
  'create-package-unknown',
  'create-organizations-without-auth',
]

const parsedArguments = parseCreateBinArguments(process.argv.slice(2))
if (parsedArguments.kind === 'create-arguments-rejected') {
  process.stderr.write(`${parsedArguments.message}\n`)
  process.exit(2)
}

const result = await createHearthkitProject(parsedArguments.createOptions)
if (result.kind === 'hearthkit-project-created') {
  process.exitCode = 0
} else {
  process.stderr.write(`${result.message}\n`)
  process.exitCode = usageFailureKinds.includes(result.kind) ? 2 : 1
}
