// The hearthkit command itself. Reached through hearthkit-bin-entry.js, never named in the bin
// field directly, because Node refuses to strip types from a .ts file under node_modules and the
// entry shim is what installs the loader hook that does it. The relative imports below name .ts
// files because that is what actually ships: there is still no build step.
import { runHearthkitCli } from './run-hearthkit-cli.ts'

const { exitCode } = await runHearthkitCli({ argv: process.argv.slice(2) })
process.exitCode = exitCode
