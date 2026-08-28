#!/usr/bin/env node
// Thin wrapper: it runs one command and exits with the code that command reports, nothing else.
// Plain .mjs on purpose. Node 24 strips TypeScript types at run time, so the .ts modules below load
// directly with no build step, but it resolves specifiers literally; the registered hook is what
// lets this package keep the .js import style the rest of the workspace is written in.
import { register } from 'node:module'

register('./hearthkit-typescript-source-resolver.mjs', import.meta.url)

const { runHearthkitCli } = await import('./run-hearthkit-cli.ts')

const { exitCode } = await runHearthkitCli({ argv: process.argv.slice(2) })
process.exitCode = exitCode
