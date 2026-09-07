/**
 * Serves the build the Dockerfile ships, which `next start` does not.
 *
 * `next.config.ts` sets `output: 'standalone'`, and Next then warns that `next start` "does not work
 * with" it. The warning understates the problem: `next start` serves `.next/`, while the container
 * serves `.next/standalone/` plus two directories Next declines to put there. Those are different
 * artifacts, so running one locally and the other in production makes "a project is a Dockerfile plus
 * environment variables" false. This script closes that gap by starting the same server the image does.
 *
 * Three jobs, in order:
 *
 * 1. Find `server.js` under `.next/standalone`. It is NOT at a fixed path. Next's output file tracing
 *    root decides where it lands, and it resolves differently in the two places this runs: nested at
 *    `.next/standalone/templates/app/server.js` inside the hearthkit workspace, because
 *    `pnpm-workspace.yaml` sits above the template, and at `.next/standalone/server.js` in a generated
 *    project, which is what the Dockerfile assumes. A literal path works in one and `ENOENT`s in the
 *    other, so this searches instead.
 * 2. Copy `public/` and `.next/static` beside it. Next puts neither into the standalone tree, and
 *    without them every stylesheet answers 404 while the pages still answer 200 — a failure that looks
 *    like a theming bug rather than a missing directory. The Dockerfile's runner stage copies exactly
 *    these two, and this mirrors it rather than inventing a third arrangement.
 * 3. Spawn it and exit with its code, so `pnpm start` behaves like the server process it stands in for.
 *
 * NO `import` STATEMENT ON PURPOSE, and this is the part not to "modernise". `package.json` has no
 * `type` field, because Next's standalone `server.js` is CommonJS and `"type": "module"` breaks it.
 * Node therefore reads this file as CommonJS — and one `import` statement would make it detect ES
 * module syntax, reparse, and print a MODULE_TYPELESS_PACKAGE_JSON warning on every `pnpm start`
 * whose own advice is to add the one field that breaks the container. Measured on Node 24.20.0.
 *
 * `process.getBuiltinModule` is how the three modules arrive instead. It is typed by `@types/node`
 * per module id, so this stays fully typed with no cast, and it can only ever answer a builtin.
 */

const nodeChildProcess = process.getBuiltinModule('node:child_process')
const nodeFs = process.getBuiltinModule('node:fs')
const nodePath = process.getBuiltinModule('node:path')

/** Unique literal prefix printed when no standalone server was found, so a failed start is greppable. */
const appStandaloneServerMissingErrorPrefix = 'hearthkit app standalone server missing:'

/** Where `next build` writes the standalone output, relative to this file. */
const standaloneOutputDirectoryPath = nodePath.join(__dirname, '.next', 'standalone')

// Two known layouts need one and three levels. The cap is what stops a mistake becoming a full walk of
// the traced dependency tree, which is large and full of files named server.js.
/** How many directory levels below `.next/standalone` the search descends before giving up. */
const maximumStandaloneSearchDepth = 4

/**
 * The directory holding the emitted `server.js`, or undefined when the build wrote none.
 *
 * `node_modules` is skipped rather than searched: the traced tree carries Next's own
 * `dist/server/…` files, and matching one of those would start a server that is not this app's.
 */
function findStandaloneServerDirectory(
  searchDirectoryPath: string,
  remainingDepth: number,
): string | undefined {
  if (nodeFs.existsSync(nodePath.join(searchDirectoryPath, 'server.js'))) {
    return searchDirectoryPath
  }
  if (remainingDepth === 0) {
    return undefined
  }

  for (const entry of nodeFs.readdirSync(searchDirectoryPath, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'node_modules') {
      continue
    }
    const foundDirectoryPath = findStandaloneServerDirectory(
      nodePath.join(searchDirectoryPath, entry.name),
      remainingDepth - 1,
    )
    if (foundDirectoryPath !== undefined) {
      return foundDirectoryPath
    }
  }

  return undefined
}

/** Copies the two directories Next leaves out of the standalone tree, exactly as the Dockerfile's runner stage does. */
function copyStandaloneStaticAssets(standaloneServerDirectoryPath: string): void {
  const publicDirectoryPath = nodePath.join(__dirname, 'public')
  if (nodeFs.existsSync(publicDirectoryPath)) {
    nodeFs.cpSync(publicDirectoryPath, nodePath.join(standaloneServerDirectoryPath, 'public'), {
      recursive: true,
    })
  }

  const staticDirectoryPath = nodePath.join(__dirname, '.next', 'static')
  if (nodeFs.existsSync(staticDirectoryPath)) {
    nodeFs.cpSync(
      staticDirectoryPath,
      nodePath.join(standaloneServerDirectoryPath, '.next', 'static'),
      { recursive: true },
    )
  }
}

/** Refuses to start, naming the directory that was searched, because a silent ENOENT here is the failure this script exists to prevent. */
function refuseToStart(failureDetail: string): never {
  process.stderr.write(`${appStandaloneServerMissingErrorPrefix} ${failureDetail}\n`)
  process.exit(1)
}

/** Locates, completes and runs the standalone build; exits with the server's own code, or 1 when there is no build to run. */
function startStandaloneServer(): void {
  if (!nodeFs.existsSync(standaloneOutputDirectoryPath)) {
    refuseToStart(`${standaloneOutputDirectoryPath} does not exist; run \`pnpm build\` first`)
  }

  const standaloneServerDirectoryPath = findStandaloneServerDirectory(
    standaloneOutputDirectoryPath,
    maximumStandaloneSearchDepth,
  )
  if (standaloneServerDirectoryPath === undefined) {
    refuseToStart(
      `no server.js within ${String(maximumStandaloneSearchDepth)} levels of ${standaloneOutputDirectoryPath}; run \`pnpm build\` again and check next.config.ts still sets output: 'standalone'`,
    )
  }

  copyStandaloneStaticAssets(standaloneServerDirectoryPath)

  // PORT and HOSTNAME are read by the standalone server itself and validated by nothing, so they are
  // passed through rather than parsed. The default matches the Dockerfile's `ENV PORT=3000`.
  const serverProcess = nodeChildProcess.spawn(
    process.execPath,
    [nodePath.join(standaloneServerDirectoryPath, 'server.js')],
    {
      cwd: standaloneServerDirectoryPath,
      stdio: 'inherit',
      env: { ...process.env, PORT: process.env.PORT ?? '3000' },
    },
  )

  // Forwarded rather than left to the process group, so `pnpm start` shuts the server down cleanly
  // whether the signal arrived from a terminal or from a supervisor.
  for (const signalName of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signalName, () => {
      serverProcess.kill(signalName)
    })
  }

  serverProcess.on('exit', (exitCode: number | null, signalName: NodeJS.Signals | null) => {
    process.exit(exitCode ?? (signalName === 'SIGINT' || signalName === 'SIGTERM' ? 0 : 1))
  })
}

startStandaloneServer()
