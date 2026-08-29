import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  appContainerDefaultPort,
  appContainerNotHealthyErrorPrefix,
  appHealthRoutePath,
  appImageBuildFailedErrorPrefix,
  appSmokeBaseUrlEnvVariableName,
  appStartupLogMessage,
  appVerifyContainerFailedErrorPrefix,
} from './app-template-contract.ts'
import { materializeAppTemplateProject } from './materialize-app-template-project.ts'
import { lastOutputLine, runVerifyCommand } from './run-verify-command.ts'

/**
 * The batched tier of this template's gating: `pnpm --filter @hearthkit/app-template run
 * verify:container`. Docker is required and it takes minutes, which is exactly why it is not the
 * `test` script — that one runs on every pull request in the repo.
 *
 * Seven observable steps, in order: materialize a self-contained project, install it, build the
 * image, run it and poll /health, assert the startup line reached the container's stdout, run the
 * Playwright smoke against it, then tear everything down. Exit 0 only when all seven passed.
 *
 * This file is hearthkit-only. It is pruned with the rest of `src/` before a project is generated.
 *
 * This script and the materializer it calls read the port, the health route, the startup line, the
 * error prefixes and the pruning lists straight out of `app-template-contract.ts`, so there is one
 * source of truth and nothing to keep in step. That import only survives because `node` runs this
 * script with no bundler: every specifier the contract reaches must stay Node-resolvable, which is
 * why the contract takes its two theme constants from `@hearthkit/ui/ui-contract` rather than the
 * `@hearthkit/ui` entry point, whose `.tsx` modules `node` refuses outright
 * (`ERR_UNKNOWN_FILE_EXTENSION`).
 *
 * `package.json` runs it with `--disable-warning=MODULE_TYPELESS_PACKAGE_JSON`: the manifest has no
 * `"type": "module"` on purpose, because Next's standalone `server.js` is CommonJS, and Node would
 * otherwise print a warning on every run advising the one change this template must not make.
 */

/** Absolute path of templates/app, resolved from this file so no path to the repo is hardcoded. */
const appTemplateRootPath = fileURLToPath(new URL('..', import.meta.url))

/** Absolute path of the hearthkit workspace root, where the packages that get packed live. */
const workspaceRootPath = fileURLToPath(new URL('../../..', import.meta.url))

/** Name the materialized project takes; a real scaffold would use the user's project name here. */
const verifyProjectName = 'hearthkit-app-template-verify'

/** How long /health may take to answer 200 before the container counts as unhealthy. */
const healthWaitTimeoutMs = 120_000

/** Gap between /health polls; short enough to keep the reported elapsed time meaningful. */
const healthPollIntervalMs = 500

/** Per-request timeout while polling, so a hung connection cannot eat the whole wait. */
const healthRequestTimeoutMs = 2000

/** Everything one verification run needs to identify and clean up after itself. */
type VerifyContainerRun = {
  temporaryDirectoryPath: string
  projectDirectoryPath: string
  containerImageTag: string
  containerName: string
}

const sleep = (durationMs: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, durationMs))

const logStep = (stepNumber: number, description: string): void => {
  process.stdout.write(`\n[verify:container ${String(stepNumber)}/7] ${description}\n`)
}

/** Published host port docker assigned to the container's app port, or undefined when it has none. */
async function readPublishedHostPort(run: VerifyContainerRun): Promise<number | undefined> {
  const portResult = await runVerifyCommand({
    command: 'docker',
    commandArguments: ['port', run.containerName, `${String(appContainerDefaultPort)}/tcp`],
    workingDirectoryPath: run.projectDirectoryPath,
  })

  const publishedPort = /:(\d+)\s*$/m.exec(portResult.stdout)?.[1]
  return publishedPort === undefined ? undefined : Number.parseInt(publishedPort, 10)
}

/** Everything the container has written to stdout and stderr so far, as one string. */
async function readContainerLogs(run: VerifyContainerRun): Promise<string> {
  const logsResult = await runVerifyCommand({
    command: 'docker',
    commandArguments: ['logs', run.containerName],
    workingDirectoryPath: run.projectDirectoryPath,
  })
  return `${logsResult.stdout}${logsResult.stderr}`
}

/** Polls /health until it answers 200; answers the elapsed milliseconds and the last status seen. */
async function waitForHealthyContainer(
  baseUrl: string,
): Promise<{ isHealthy: boolean; waitedMs: number; lastStatusCode: number | undefined }> {
  const startedAtMs = Date.now()
  let lastStatusCode: number | undefined

  while (Date.now() - startedAtMs < healthWaitTimeoutMs) {
    try {
      const response = await fetch(`${baseUrl}${appHealthRoutePath}`, {
        signal: AbortSignal.timeout(healthRequestTimeoutMs),
      })
      lastStatusCode = response.status
      if (response.status === 200) {
        return { isHealthy: true, waitedMs: Date.now() - startedAtMs, lastStatusCode }
      }
    } catch {
      // Connection refused while the server is still coming up is expected, so keep polling.
    }
    await sleep(healthPollIntervalMs)
  }

  return { isHealthy: false, waitedMs: Date.now() - startedAtMs, lastStatusCode }
}

/**
 * Runs steps one to six and answers the message to print as the last stderr line, or undefined when
 * everything passed. Teardown happens in the caller so that message is genuinely printed last.
 */
async function verifyAppContainer(run: VerifyContainerRun): Promise<string | undefined> {
  logStep(1, 'materializing a self-contained project from the template')
  await materializeAppTemplateProject({
    templateDirectoryPath: appTemplateRootPath,
    workspaceRootPath,
    projectDirectoryPath: run.projectDirectoryPath,
    projectName: verifyProjectName,
  })
  process.stdout.write(`materialized at ${run.projectDirectoryPath}\n`)

  logStep(2, 'installing the project, which writes the lockfile the image build consumes')
  const installResult = await runVerifyCommand({
    command: 'pnpm',
    commandArguments: ['install', '--ignore-workspace'],
    workingDirectoryPath: run.projectDirectoryPath,
    streamOutput: true,
  })
  if (installResult.exitCode !== 0) {
    return `${appVerifyContainerFailedErrorPrefix} pnpm install exited ${String(installResult.exitCode)}: ${lastOutputLine(installResult.stderr)}`
  }

  logStep(3, `building the image as ${run.containerImageTag}`)
  const buildResult = await runVerifyCommand({
    command: 'docker',
    commandArguments: ['build', '--tag', run.containerImageTag, '.'],
    workingDirectoryPath: run.projectDirectoryPath,
    streamOutput: true,
  })
  if (buildResult.exitCode !== 0) {
    return `${appImageBuildFailedErrorPrefix} docker build exited ${String(buildResult.exitCode)}: ${lastOutputLine(buildResult.stderr)}`
  }

  logStep(4, 'running the container and polling the health route')
  const runContainerResult = await runVerifyCommand({
    command: 'docker',
    commandArguments: [
      'run',
      '--detach',
      '--name',
      run.containerName,
      '--publish',
      `0:${String(appContainerDefaultPort)}`,
      run.containerImageTag,
    ],
    workingDirectoryPath: run.projectDirectoryPath,
  })
  if (runContainerResult.exitCode !== 0) {
    return `${appVerifyContainerFailedErrorPrefix} docker run exited ${String(runContainerResult.exitCode)}: ${lastOutputLine(runContainerResult.stderr)}`
  }

  const publishedHostPort = await readPublishedHostPort(run)
  if (publishedHostPort === undefined) {
    return `${appVerifyContainerFailedErrorPrefix} docker published no host port for container port ${String(appContainerDefaultPort)}`
  }

  const containerBaseUrl = `http://127.0.0.1:${String(publishedHostPort)}`
  const health = await waitForHealthyContainer(containerBaseUrl)
  if (!health.isHealthy) {
    process.stderr.write(`${await readContainerLogs(run)}\n`)
    const observedStatus =
      health.lastStatusCode === undefined
        ? 'no response'
        : `last status ${String(health.lastStatusCode)}`
    return `${appContainerNotHealthyErrorPrefix} ${appHealthRoutePath} never answered 200 after ${String(health.waitedMs)} ms (${observedStatus})`
  }
  process.stdout.write(
    `${appHealthRoutePath} answered 200 after ${String(health.waitedMs)} ms at ${containerBaseUrl}\n`,
  )

  logStep(5, 'asserting the startup line reached the container stdout')
  const containerLogs = await readContainerLogs(run)
  if (!containerLogs.includes(appStartupLogMessage)) {
    process.stderr.write(`${containerLogs}\n`)
    return `${appVerifyContainerFailedErrorPrefix} the container logs never contained '${appStartupLogMessage}', so config loading, logging or the standalone server did not run`
  }
  process.stdout.write(`container logged '${appStartupLogMessage}'\n`)

  logStep(6, 'running the Playwright smoke test against the container')
  const browserInstallResult = await runVerifyCommand({
    command: 'pnpm',
    commandArguments: ['exec', 'playwright', 'install', 'chromium'],
    workingDirectoryPath: run.projectDirectoryPath,
    streamOutput: true,
  })
  if (browserInstallResult.exitCode !== 0) {
    return `${appVerifyContainerFailedErrorPrefix} playwright install exited ${String(browserInstallResult.exitCode)}: ${lastOutputLine(browserInstallResult.stderr)}`
  }

  const smokeResult = await runVerifyCommand({
    command: 'pnpm',
    commandArguments: ['exec', 'playwright', 'test'],
    workingDirectoryPath: run.projectDirectoryPath,
    extraEnvironment: { [appSmokeBaseUrlEnvVariableName]: containerBaseUrl },
    streamOutput: true,
  })
  if (smokeResult.exitCode !== 0) {
    return `${appVerifyContainerFailedErrorPrefix} the Playwright smoke test exited ${String(smokeResult.exitCode)} against ${containerBaseUrl}`
  }

  return undefined
}

/** Removes the container, the image and the temporary directory; never writes to stderr, so a failure message stays last. */
async function tearDownVerifyContainerRun(run: VerifyContainerRun): Promise<void> {
  logStep(7, 'tearing down the container, the image and the temporary directory')

  await runVerifyCommand({
    command: 'docker',
    commandArguments: ['rm', '--force', '--volumes', run.containerName],
    workingDirectoryPath: workspaceRootPath,
  })
  await runVerifyCommand({
    command: 'docker',
    commandArguments: ['rmi', '--force', run.containerImageTag],
    workingDirectoryPath: workspaceRootPath,
  })
  await rm(run.temporaryDirectoryPath, { recursive: true, force: true })
}

/** Entry point: exit 0 when all seven steps passed, exit 1 with the failure as the last stderr line. */
async function main(): Promise<never> {
  const temporaryDirectoryPath = await mkdtemp(join(tmpdir(), 'hearthkit-app-template-'))
  const runIdentifier = temporaryDirectoryPath.slice(-8).toLowerCase()
  const run: VerifyContainerRun = {
    temporaryDirectoryPath,
    projectDirectoryPath: join(temporaryDirectoryPath, verifyProjectName),
    containerImageTag: `${verifyProjectName}:${runIdentifier}`,
    containerName: `${verifyProjectName}-${runIdentifier}`,
  }

  let failureMessage: string | undefined
  try {
    failureMessage = await verifyAppContainer(run)
  } catch (error) {
    failureMessage =
      error instanceof Error
        ? error.message
        : `${appVerifyContainerFailedErrorPrefix} ${String(error)}`
  } finally {
    await tearDownVerifyContainerRun(run)
  }

  if (failureMessage !== undefined) {
    process.stderr.write(`${failureMessage}\n`)
    process.exit(1)
  }

  process.stdout.write('\nverify:container passed all seven steps\n')
  process.exit(0)
}

await main()
