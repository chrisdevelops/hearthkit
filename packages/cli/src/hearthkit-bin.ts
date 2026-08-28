#!/usr/bin/env node
// Node 24 runs this TypeScript file directly by stripping types, so there is no build step and no
// resolver hook; the relative imports below name .ts files because that is what actually ships.
import { runHearthkitCli } from './run-hearthkit-cli.ts'

const { exitCode } = await runHearthkitCli({ argv: process.argv.slice(2) })
process.exitCode = exitCode
