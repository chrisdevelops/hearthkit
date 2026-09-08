// The only JavaScript file in @hearthkit/cli, and the single permitted exception to the repo rule
// "TypeScript for every script". Node 24.20.0 refuses to strip types from any `.ts` file that sits
// under a `node_modules` directory (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING, thrown from
// node:internal/modules/typescript), and no CLI flag lifts that restriction, so the moment a
// package that ships TypeScript source is installed into a project, every entry point that loads it
// from bare Node becomes unrunnable: the `hearthkit` bin, the `create-hearthkit-project` bin, and
// each Playwright worker process the generated project forks. The ruling on 2026-09-07 was to keep
// shipping TypeScript source with no build step and to bootstrap it instead. This file must be
// plain JavaScript because it has to execute before any type stripping is available to it, and all
// it does, as a side effect of being imported, is install a loader hook that strips the types
// itself. Everything else in this package stays TypeScript.
//
// Importing this module is the whole API. It is exported as
// `@hearthkit/cli/register-node-modules-type-stripping` so the three entry points share one copy
// rather than each carrying its own: `hearthkit-bin-entry.js` and `@hearthkit/create`'s
// `create-bin-entry.js` import it and then dynamically import their TypeScript bin, and the app
// template's `test:e2e` script preloads it into Playwright's workers with
// `NODE_OPTIONS=--import=@hearthkit/cli/register-node-modules-type-stripping`.
//
// API reference checked against the current Node 24 docs on 2026-09-07:
// https://nodejs.org/docs/latest-v24.x/api/module.html

import { readFileSync } from 'node:fs'
import { registerHooks, stripTypeScriptTypes } from 'node:module'
import { fileURLToPath } from 'node:url'

/**
 * The exact message `module.stripTypeScriptTypes` emits the first time it is called. Matched in
 * full rather than by prefix, so a warning about anything else is never swallowed by accident.
 */
const stripTypeScriptTypesExperimentalWarningText =
  'stripTypeScriptTypes is an experimental feature and might change at any time'

/** The text of a warning however it was raised: as a string, as an Error, or as neither. */
function warningMessageText(warning) {
  if (typeof warning === 'string') {
    return warning
  }
  if (warning instanceof Error) {
    return warning.message
  }
  return ''
}

/**
 * Silences that one ExperimentalWarning, so a successful run writes nothing at all to stderr.
 *
 * Done by wrapping `process.emitWarning` rather than `process.removeAllListeners('warning')` or
 * `--disable-warning`, both of which would hide every other warning Node has to tell an operator
 * about. Node caches experimental warnings by feature name and emits each one only once, so a
 * single priming call while the wrapper is installed retires this warning for the life of the
 * process; `process.emitWarning` is put back immediately afterwards and nothing later in the run
 * sees a patched global.
 */
function suppressStripTypeScriptTypesExperimentalWarning() {
  const emitOriginalWarning = process.emitWarning.bind(process)
  process.emitWarning = (warning, ...remainingArguments) => {
    if (warningMessageText(warning) !== stripTypeScriptTypesExperimentalWarningText) {
      emitOriginalWarning(warning, ...remainingArguments)
    }
  }
  try {
    stripTypeScriptTypes('')
  } finally {
    process.emitWarning = emitOriginalWarning
  }
}

/** True when a file: URL has a `node_modules` path segment, the only case Node refuses to strip. */
function isUnderNodeModulesDirectory(fileUrl) {
  return new URL(fileUrl).pathname.split('/').includes('node_modules')
}

/**
 * Teaches this process to load the `.ts` files Node will not load for itself.
 *
 * Deliberately narrow. It claims only `file:` URLs ending in `.ts` that live under `node_modules`,
 * which is exactly the set Node rejects; every other specifier, including the hearthkit packages'
 * own sources when they run from the pnpm workspace (pnpm links resolve to real paths outside
 * `node_modules`) and including a scaffolded project's own `.ts` files, falls through to `nextLoad`
 * and is handled natively. That is what makes the hook harmless outside an installed tree rather
 * than merely equivalent, and what makes it safe to preload into every process `NODE_OPTIONS`
 * reaches.
 *
 * `format: 'module'` is correct for everything it claims because every `@hearthkit/*` package
 * declares `"type": "module"`, and a package that ships `.ts` without that declaration cannot be
 * loaded by Node at all today. Mode is `strip`, the default, which blanks type annotations out in
 * place instead of rewriting them, so line and column numbers still match the file on disk; no
 * `sourceUrl` is passed because the module URL is already the resource name V8 reports in a stack
 * trace (verified: stacks are byte-identical with and without it), and `sourceMap` is rejected
 * outright by `strip` mode.
 */
function registerNodeModulesTypeStrippingHook() {
  registerHooks({
    load(url, context, nextLoad) {
      if (!url.startsWith('file:') || !url.endsWith('.ts') || !isUnderNodeModulesDirectory(url)) {
        return nextLoad(url, context)
      }
      return {
        format: 'module',
        source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), { mode: 'strip' }),
        shortCircuit: true,
      }
    },
  })
}

suppressStripTypeScriptTypesExperimentalWarning()
registerNodeModulesTypeStrippingHook()
