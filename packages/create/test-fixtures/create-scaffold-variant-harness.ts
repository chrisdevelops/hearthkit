import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseEnv } from 'node:util'
import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import {
  createGateDirectory,
  expectHearthkitProjectCreated,
  loadHearthkitCreateEntry,
  manifestSectionOf,
  readProjectManifest,
  removeGateDirectory,
  reserveFreeTcpPort,
  runGateCommand,
  uniqueGateProjectName,
} from './create-gate-project-directories.ts'
import {
  appContainerDefaultPort,
  appHealthRoutePath,
  appMailpitApiBaseUrlEnvVariableName,
  appSmokeBaseUrlEnvVariableName,
  appStartupLogMessage,
  appTemplateDirectoryPath,
  appTemplateSectionsByOptionalPackage,
  hearthkitWorkspaceRootPath,
  type AppTemplateOptionalPackageName,
} from './create-gate-template-manifest.ts'

/**
 * The slow tier's machinery: one function that takes a variant and drives it from an empty directory
 * to a booted app with its Playwright flows run. Only reached when HEARTHKIT_SCAFFOLD_GATES=1.
 *
 * Two things here are the harness standing in for infrastructure that does not exist yet, and both
 * are deliberate:
 *
 * 1. The packages arrive as tarballs `pnpm pack` wrote, the mechanism
 *    `templates/app/src/materialize-app-template-project.ts` already uses, mapped in through
 *    `pnpm.overrides` in the scaffolded project. Overrides rather than the dependency specifiers
 *    create wrote, for two reasons a gate cannot design around: one `packageVersion` string cannot
 *    name N different tarballs, and `pnpm pack` rewrites a package's own `workspace:*` dependencies
 *    to `0.0.0`, which resolves nowhere until the packages are published. Overrides catch both the
 *    direct and the transitive reference in one place. Reported as a contract gap.
 * 2. The services are the repo's own compose Postgres and MinIO, plus a Mailpit of this run's own on
 *    reserved ports. Never the shared Mailpit: @hearthkit/email's gates assert exact message counts
 *    on it, and a flow reading it would break them and be broken by them.
 *
 * Nothing here mocks anything. The Stripe key is read from the environment or the git-ignored root
 * `.env`, and a missing key fails the variant rather than skipping the payments flow, because plan
 * 4.8 says these run live and a skipped flow is not a passing flow.
 */

/** Prefix of every message this harness throws, so a setup failure never reads like a gate failure. */
export const scaffoldGateSetupFailedErrorPrefix = 'hearthkit create scaffold gate setup failed:'

/** Container names and images the harness starts itself; the compose services it only reads. */
const isolatedMailpitImage = 'axllent/mailpit:v1.31'

/** Compose container names the repo's own docker-compose.yml gives the two services a flow needs. */
const sharedPostgresContainerName = 'hearthkit-postgres'
const sharedMinioContainerName = 'hearthkit-minio'

/** Credentials the repo compose file gives Postgres and MinIO; the same pair the CLI bakes into a generated one. */
const sharedInfraCredential = 'hearthkit'

/** How long the built app has to answer /health with 200 before the variant counts as unbooted. */
const healthWaitTimeoutMs = 180_000

/** One scaffold variant plan 4.10 names, and what its resolved set implies. */
export type ScaffoldVariantPlan = {
  variantName: 'every-package' | 'no-package' | 'auth-with-organizations'
  packages: string[]
  organizations: boolean
  expectedResolvedPackages: string[]
  buildsContainerImage: boolean
}

/** The three variants, exactly as plan 4.10 lists them. */
export const scaffoldVariantPlans = [
  {
    variantName: 'every-package',
    packages: ['storage', 'email', 'auth', 'payments'],
    organizations: false,
    expectedResolvedPackages: ['db', 'storage', 'email', 'auth', 'payments'],
    buildsContainerImage: false,
  },
  {
    variantName: 'no-package',
    packages: [],
    organizations: false,
    expectedResolvedPackages: [],
    buildsContainerImage: true,
  },
  {
    variantName: 'auth-with-organizations',
    packages: ['auth'],
    organizations: true,
    expectedResolvedPackages: ['db', 'email', 'auth'],
    buildsContainerImage: false,
  },
] as const satisfies readonly ScaffoldVariantPlan[]

/** One Playwright test as the JSON reporter described it, flattened out of the nested suites. */
export type PlaywrightTestOutcome = {
  specFilePath: string
  testTitle: string
  status: string
}

/** Everything one variant produced, for the gate to assert on. */
export type ScaffoldVariantOutcome = {
  projectDirectoryPath: string
  resolvedPackages: string[]
  organizationsEnabled: boolean
  installExitCode: number
  typecheckExitCode: number
  buildExitCode: number
  healthStatusCode: number | undefined
  playwrightExitCode: number
  playwrightTestOutcomes: PlaywrightTestOutcome[]
  containerHealthStatusCode: number | undefined
  containerLoggedStartupMessage: boolean | undefined
}

/** Throws with the harness prefix, so a machine that is not set up says so instead of failing an assertion. */
function failSetup(detail: string): never {
  throw new Error(`${scaffoldGateSetupFailedErrorPrefix} ${detail}`)
}

/**
 * Reads the git-ignored root `.env` into process.env for keys that are not already set, which is
 * where the Stripe test-mode pair lives locally. In CI both arrive as secrets and this does nothing.
 */
function loadRootEnvFile(): void {
  const rootEnvFilePath = join(hearthkitWorkspaceRootPath, '.env')
  if (!existsSync(rootEnvFilePath)) {
    return
  }
  for (const [variableName, value] of Object.entries(
    parseEnv(readFileSync(rootEnvFilePath, 'utf8')),
  )) {
    if (process.env[variableName] === undefined && typeof value === 'string') {
      process.env[variableName] = value
    }
  }
}

/** The template selection a resolved set implies: everything but db, under its scoped package name. */
function selectedSectionPackageNames(
  resolvedPackages: readonly string[],
): AppTemplateOptionalPackageName[] {
  return resolvedPackages
    .filter((resolvedPackage) => resolvedPackage !== 'db')
    .map((resolvedPackage) => `@hearthkit/${resolvedPackage}` as AppTemplateOptionalPackageName)
}

/**
 * The Playwright test directory the template's playwright.config.ts sets, as a path prefix.
 *
 * The JSON reporter writes `spec.file` RELATIVE TO the config's `testDir`, not relative to the
 * project root, so a spec the manifest calls `e2e/storage-upload-flow.spec.ts` is reported as
 * `storage-upload-flow.spec.ts`. Every expected path below is stripped of this prefix for that
 * reason; comparing manifest paths to reported paths directly never matches.
 */
const playwrightTestDirectoryPrefix = 'e2e/'

/** The manifest's project-relative spec path as the JSON reporter names it: relative to testDir. */
function reportedSpecFilePathOf(projectRelativeSpecPath: string): string {
  return projectRelativeSpecPath.startsWith(playwrightTestDirectoryPrefix)
    ? projectRelativeSpecPath.slice(playwrightTestDirectoryPrefix.length)
    : projectRelativeSpecPath
}

/** The e2e spec paths a variant must run: the always-on smoke test plus one flow per selected package. */
export function expectedSpecFilePaths(resolvedPackages: readonly string[]): string[] {
  return [
    reportedSpecFilePathOf('e2e/app-smoke.spec.ts'),
    ...selectedSectionPackageNames(resolvedPackages).map((optionalPackageName) =>
      reportedSpecFilePathOf(
        appTemplateSectionsByOptionalPackage[optionalPackageName].flowSpecPath,
      ),
    ),
  ].toSorted()
}

/** Runs a docker command, failing the variant with the harness prefix when docker itself is unusable. */
async function runDockerCommand(
  commandArguments: readonly string[],
  options: { allowFailure?: boolean } = {},
): Promise<string> {
  const outcome = await runGateCommand({
    command: 'docker',
    commandArguments,
    workingDirectoryPath: hearthkitWorkspaceRootPath,
  })
  if (outcome.exitCode !== 0 && options.allowFailure !== true) {
    failSetup(
      `docker ${commandArguments.join(' ')} exited ${String(outcome.exitCode)}: ${outcome.standardError.trim()}`,
    )
  }
  return outcome.standardOutput
}

/** Asserts the repo's own compose service is up, because these gates read it rather than start it. */
async function requireSharedInfraContainer(containerName: string): Promise<void> {
  const runningNames = await runDockerCommand([
    'ps',
    '--filter',
    `name=^${containerName}$`,
    '--format',
    '{{.Names}}',
  ])
  if (!runningNames.split('\n').includes(containerName)) {
    failSetup(
      `${containerName} is not running; start the repo services with 'docker compose up -d --wait' at the repo root`,
    )
  }
}

/** Polls a URL until it answers 200, or gives up and reports the last status it saw. */
async function waitForHealthyServer(baseUrl: string): Promise<number | undefined> {
  const startedAtMs = Date.now()
  let lastStatusCode: number | undefined

  while (Date.now() - startedAtMs < healthWaitTimeoutMs) {
    try {
      const response = await fetch(`${baseUrl}${appHealthRoutePath}`, {
        signal: AbortSignal.timeout(2000),
      })
      lastStatusCode = response.status
      if (response.status === 200) {
        return response.status
      }
    } catch {
      // Connection refused while the server is still coming up is expected, so keep polling.
    }
    await sleep(500)
  }
  return lastStatusCode
}

/** Flattens the Playwright JSON report into one entry per test, whatever depth its suites nested to. */
function flattenPlaywrightReport(reportJson: unknown): PlaywrightTestOutcome[] {
  const outcomes: PlaywrightTestOutcome[] = []

  const visitSuite = (suite: unknown): void => {
    if (typeof suite !== 'object' || suite === null) {
      return
    }
    const { specs, suites } = suite as { specs?: unknown; suites?: unknown }
    if (Array.isArray(specs)) {
      for (const spec of specs) {
        const { file, title, tests } = spec as { file?: unknown; title?: unknown; tests?: unknown }
        const specFilePath = typeof file === 'string' ? file : 'unknown spec file'
        const testTitle = typeof title === 'string' ? title : 'unknown test'
        if (Array.isArray(tests)) {
          for (const test of tests) {
            const { status } = test as { status?: unknown }
            outcomes.push({
              specFilePath,
              testTitle,
              status: typeof status === 'string' ? status : 'unknown',
            })
          }
        }
      }
    }
    if (Array.isArray(suites)) {
      for (const nestedSuite of suites) {
        visitSuite(nestedSuite)
      }
    }
  }

  visitSuite(reportJson)
  if (typeof reportJson === 'object' && reportJson !== null) {
    const { suites } = reportJson as { suites?: unknown }
    if (Array.isArray(suites)) {
      for (const suite of suites) {
        visitSuite(suite)
      }
    }
  }
  return outcomes
}

/**
 * Packs every @hearthkit package the scaffolded manifest names into the project and maps all of
 * them, direct and transitive, through pnpm.overrides.
 */
async function packHearthkitPackagesInto(projectDirectoryPath: string): Promise<void> {
  const manifest = await readProjectManifest(projectDirectoryPath)
  const declaredHearthkitNames = [
    ...Object.keys(manifestSectionOf(manifest, 'dependencies')),
    ...Object.keys(manifestSectionOf(manifest, 'devDependencies')),
  ].filter((dependencyName) => dependencyName.startsWith('@hearthkit/'))

  // The transitive closure, because a packed tarball asks for its own hearthkit dependencies by a
  // version that is not published yet.
  const packageNamesToPack = new Set<string>(declaredHearthkitNames)
  for (const packageName of packageNamesToPack) {
    const packageDirectoryPath = join(
      hearthkitWorkspaceRootPath,
      'packages',
      packageName.replace('@hearthkit/', ''),
    )
    const packageManifest: unknown = JSON.parse(
      await readFile(join(packageDirectoryPath, 'package.json'), 'utf8'),
    )
    const dependencies = (packageManifest as { dependencies?: Record<string, string> }).dependencies
    for (const dependencyName of Object.keys(dependencies ?? {})) {
      if (dependencyName.startsWith('@hearthkit/')) {
        packageNamesToPack.add(dependencyName)
      }
    }
  }

  const packDestinationPath = join(projectDirectoryPath, 'hearthkit-packages')
  await mkdir(packDestinationPath, { recursive: true })
  const overrides: Record<string, string> = {}

  for (const packageName of packageNamesToPack) {
    const packageDirectoryName = packageName.replace('@hearthkit/', '')
    const packOutcome = await runGateCommand({
      command: 'pnpm',
      commandArguments: ['pack', '--pack-destination', packDestinationPath],
      workingDirectoryPath: join(hearthkitWorkspaceRootPath, 'packages', packageDirectoryName),
    })
    if (packOutcome.exitCode !== 0) {
      failSetup(
        `pnpm pack exited ${String(packOutcome.exitCode)} for ${packageName}: ${packOutcome.standardError.trim()}`,
      )
    }
    const [tarballFileName] = (await readdir(packDestinationPath)).filter((fileName) =>
      fileName.startsWith(`hearthkit-${packageDirectoryName}-`),
    )
    if (tarballFileName === undefined) {
      failSetup(`pnpm pack wrote no tarball for ${packageName} in ${packDestinationPath}`)
    }
    overrides[packageName] = `file:./hearthkit-packages/${tarballFileName}`
  }

  const pnpmSection = manifest.pnpm
  manifest.pnpm = {
    ...(typeof pnpmSection === 'object' && pnpmSection !== null ? pnpmSection : {}),
    overrides,
  }
  await writeFile(
    join(projectDirectoryPath, 'package.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  )
}

/** Everything one variant started that has to be stopped again, whatever happened in between. */
type ScaffoldVariantResources = {
  gateDirectoryPath: string
  projectDatabaseName: string | undefined
  storageBucketName: string | undefined
  mailpitContainerName: string | undefined
  appServerProcess: ChildProcess | undefined
  containerImageTag: string | undefined
  containerName: string | undefined
}

/** Stops and removes everything the run created; never throws, so a gate failure stays the reported one. */
async function tearDownScaffoldVariant(resources: ScaffoldVariantResources): Promise<void> {
  resources.appServerProcess?.kill('SIGTERM')
  if (resources.containerName !== undefined) {
    await runDockerCommand(['rm', '--force', '--volumes', resources.containerName], {
      allowFailure: true,
    })
  }
  if (resources.containerImageTag !== undefined) {
    await runDockerCommand(['rmi', '--force', resources.containerImageTag], { allowFailure: true })
  }
  if (resources.mailpitContainerName !== undefined) {
    await runDockerCommand(['rm', '--force', resources.mailpitContainerName], {
      allowFailure: true,
    })
  }
  if (resources.projectDatabaseName !== undefined) {
    await runDockerCommand(
      [
        'exec',
        sharedPostgresContainerName,
        'dropdb',
        '--if-exists',
        '--force',
        '--username',
        sharedInfraCredential,
        resources.projectDatabaseName,
      ],
      { allowFailure: true },
    )
  }
  if (resources.storageBucketName !== undefined) {
    await runDockerCommand(
      [
        'exec',
        sharedMinioContainerName,
        'mc',
        'rb',
        '--force',
        `local/${resources.storageBucketName}`,
      ],
      { allowFailure: true },
    )
  }
  await removeGateDirectory(resources.gateDirectoryPath)
}

/**
 * Scaffolds one variant, installs it from packed tarballs, typechecks it, boots it, runs its
 * Playwright specs, and for the empty variant builds and runs its Dockerfile too. Returns what
 * happened; the gate decides what is acceptable.
 */
export async function runScaffoldVariant(
  plan: ScaffoldVariantPlan,
): Promise<{ outcome: ScaffoldVariantOutcome; tearDown: () => Promise<void> }> {
  loadRootEnvFile()

  const entry = await loadHearthkitCreateEntry()
  const gateDirectoryPath = await createGateDirectory(plan.variantName)
  const resources: ScaffoldVariantResources = {
    gateDirectoryPath,
    projectDatabaseName: undefined,
    storageBucketName: undefined,
    mailpitContainerName: undefined,
    appServerProcess: undefined,
    containerImageTag: undefined,
    containerName: undefined,
  }
  const tearDown = async (): Promise<void> => tearDownScaffoldVariant(resources)

  try {
    const projectName = uniqueGateProjectName(plan.variantName)
    const created = expectHearthkitProjectCreated(
      entry,
      await entry.createHearthkitProject({
        projectName,
        packages: plan.packages,
        organizations: plan.organizations,
        targetDirectory: join(gateDirectoryPath, projectName),
        install: false,
        startInfra: false,
        interactive: false,
        templateDirectoryPath: appTemplateDirectoryPath,
      }),
    )
    const { projectDirectoryPath, resolvedPackages } = created
    const needsDatabase = resolvedPackages.includes('db')
    const needsStorage = resolvedPackages.includes('storage')
    const needsEmail = resolvedPackages.includes('email')
    const needsPayments = resolvedPackages.includes('payments')

    if (needsDatabase) {
      await requireSharedInfraContainer(sharedPostgresContainerName)
    }
    if (needsStorage) {
      await requireSharedInfraContainer(sharedMinioContainerName)
    }
    if (needsPayments && (process.env.STRIPE_SECRET_KEY ?? '').trim() === '') {
      failSetup(
        'STRIPE_SECRET_KEY is unset, so the payments flow would skip itself; put the test-mode pair in the git-ignored root .env or the CI secret',
      )
    }

    const applicationEnvironment: Record<string, string> = { NODE_ENV: 'production' }

    if (needsDatabase) {
      resources.projectDatabaseName = projectName.replaceAll('-', '_')
      await runDockerCommand([
        'exec',
        sharedPostgresContainerName,
        'createdb',
        '--username',
        sharedInfraCredential,
        resources.projectDatabaseName,
      ])
      applicationEnvironment.DATABASE_URL = `postgresql://${sharedInfraCredential}:${sharedInfraCredential}@127.0.0.1:5432/${resources.projectDatabaseName}`
      applicationEnvironment.AUTH_SECRET = `hearthkit-create-gate-${projectName}-secret-value`
    }

    if (needsStorage) {
      resources.storageBucketName = `${projectName}-uploads`
      // The `local` alias lives in the container's own mc config, so a fresh compose start has no
      // credentialed one and `mc mb` is denied; set it every run rather than inheriting one.
      await runDockerCommand([
        'exec',
        sharedMinioContainerName,
        'mc',
        'alias',
        'set',
        'local',
        'http://127.0.0.1:9000',
        sharedInfraCredential,
        sharedInfraCredential,
      ])
      await runDockerCommand([
        'exec',
        sharedMinioContainerName,
        'mc',
        'mb',
        '--ignore-existing',
        `local/${resources.storageBucketName}`,
      ])
      applicationEnvironment.STORAGE_ENDPOINT = 'http://127.0.0.1:9000'
      applicationEnvironment.STORAGE_BUCKET = resources.storageBucketName
      applicationEnvironment.STORAGE_REGION = 'auto'
      applicationEnvironment.STORAGE_ACCESS_KEY_ID = sharedInfraCredential
      applicationEnvironment.STORAGE_SECRET_ACCESS_KEY = sharedInfraCredential
    }

    if (needsEmail) {
      // This run's own Mailpit on reserved ports. Never the shared one on 1025/8025.
      const smtpHostPort = await reserveFreeTcpPort()
      const mailpitApiHostPort = await reserveFreeTcpPort()
      resources.mailpitContainerName = `${projectName}-mailpit`
      await runDockerCommand([
        'run',
        '--detach',
        '--name',
        resources.mailpitContainerName,
        '--publish',
        `${String(smtpHostPort)}:1025`,
        '--publish',
        `${String(mailpitApiHostPort)}:8025`,
        isolatedMailpitImage,
      ])
      applicationEnvironment.EMAIL_TRANSPORT = 'smtp'
      applicationEnvironment.EMAIL_FROM = `hearthkit create gate <no-reply@${projectName}.example.com>`
      applicationEnvironment.EMAIL_SMTP_HOST = '127.0.0.1'
      applicationEnvironment.EMAIL_SMTP_PORT = String(smtpHostPort)
      applicationEnvironment[appMailpitApiBaseUrlEnvVariableName] =
        `http://127.0.0.1:${String(mailpitApiHostPort)}`
    }

    if (needsPayments) {
      applicationEnvironment.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? ''
      applicationEnvironment.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? ''
    }

    await packHearthkitPackagesInto(projectDirectoryPath)

    const installOutcome = await runGateCommand({
      command: 'pnpm',
      commandArguments: ['install', '--ignore-workspace'],
      workingDirectoryPath: projectDirectoryPath,
      streamOutput: true,
    })

    const typecheckOutcome = await runGateCommand({
      command: 'pnpm',
      commandArguments: ['run', 'typecheck'],
      workingDirectoryPath: projectDirectoryPath,
      environmentOverrides: applicationEnvironment,
      streamOutput: true,
    })

    if (needsDatabase) {
      const generateOutcome = await runGateCommand({
        command: 'pnpm',
        commandArguments: ['run', 'db:generate'],
        workingDirectoryPath: projectDirectoryPath,
        environmentOverrides: applicationEnvironment,
      })
      if (generateOutcome.exitCode !== 0) {
        failSetup(
          `pnpm db:generate exited ${String(generateOutcome.exitCode)}: ${generateOutcome.standardError.trim()}`,
        )
      }
      const migrateOutcome = await runGateCommand({
        command: 'pnpm',
        commandArguments: [
          'exec',
          'hearthkit',
          'db',
          'migrate',
          '--migrations-folder',
          './drizzle',
        ],
        workingDirectoryPath: projectDirectoryPath,
        environmentOverrides: applicationEnvironment,
      })
      if (migrateOutcome.exitCode !== 0) {
        failSetup(
          `hearthkit db migrate exited ${String(migrateOutcome.exitCode)}: ${migrateOutcome.standardError.trim()}`,
        )
      }
    }

    const buildOutcome = await runGateCommand({
      command: 'pnpm',
      commandArguments: ['run', 'build'],
      workingDirectoryPath: projectDirectoryPath,
      environmentOverrides: applicationEnvironment,
      streamOutput: true,
    })

    // A port of this run's own: playwright.config reuses whatever is already on 3000 outside CI, and
    // an unrelated app on the developer's machine has been found listening there.
    const applicationHostPort = await reserveFreeTcpPort()
    const applicationBaseUrl = `http://127.0.0.1:${String(applicationHostPort)}`
    if (needsDatabase) {
      applicationEnvironment.AUTH_BASE_URL = applicationBaseUrl
    }

    let healthStatusCode: number | undefined
    let playwrightExitCode = -1
    let playwrightTestOutcomes: PlaywrightTestOutcome[] = []

    if (buildOutcome.exitCode === 0) {
      resources.appServerProcess = spawn('pnpm', ['run', 'start'], {
        cwd: projectDirectoryPath,
        env: {
          ...process.env,
          ...applicationEnvironment,
          PORT: String(applicationHostPort),
          HOSTNAME: '127.0.0.1',
        },
        stdio: ['ignore', 'inherit', 'inherit'],
      })
      healthStatusCode = await waitForHealthyServer(applicationBaseUrl)

      const browserInstallOutcome = await runGateCommand({
        command: 'pnpm',
        commandArguments: ['exec', 'playwright', 'install', 'chromium'],
        workingDirectoryPath: projectDirectoryPath,
      })
      if (browserInstallOutcome.exitCode !== 0) {
        failSetup(
          `playwright install chromium exited ${String(browserInstallOutcome.exitCode)}: ${browserInstallOutcome.standardError.trim()}`,
        )
      }

      const reportFilePath = join(gateDirectoryPath, 'playwright-report.json')
      // The script, not the binary: `test:e2e` carries the NODE_OPTIONS import that lets Playwright's
      // workers load .ts under node_modules, and it is the entry point the generated ci.yml runs.
      // No `--` separator: pnpm 10 forwards an unknown flag after the script name to the script as it
      // is, and passes a literal `--` through, which Playwright then reads as a positional filter and
      // --reporter=json with it, leaving the list reporter on and no JSON report written.
      const playwrightOutcome = await runGateCommand({
        command: 'pnpm',
        commandArguments: ['run', 'test:e2e', '--reporter=json'],
        workingDirectoryPath: projectDirectoryPath,
        environmentOverrides: {
          ...applicationEnvironment,
          [appSmokeBaseUrlEnvVariableName]: applicationBaseUrl,
          PLAYWRIGHT_JSON_OUTPUT_NAME: reportFilePath,
        },
        streamOutput: true,
      })
      playwrightExitCode = playwrightOutcome.exitCode
      playwrightTestOutcomes = flattenPlaywrightReport(
        JSON.parse(await readFile(reportFilePath, 'utf8')),
      )
    }

    let containerHealthStatusCode: number | undefined
    let containerLoggedStartupMessage: boolean | undefined

    if (plan.buildsContainerImage) {
      resources.containerImageTag = `${projectName}:gate`
      resources.containerName = `${projectName}-container`
      await runDockerCommand(['build', '--tag', resources.containerImageTag, projectDirectoryPath])
      const containerHostPort = await reserveFreeTcpPort()
      await runDockerCommand([
        'run',
        '--detach',
        '--name',
        resources.containerName,
        '--publish',
        `${String(containerHostPort)}:${String(appContainerDefaultPort)}`,
        resources.containerImageTag,
      ])
      containerHealthStatusCode = await waitForHealthyServer(
        `http://127.0.0.1:${String(containerHostPort)}`,
      )
      // docker writes a container's stderr to its own stderr, and the startup line is logged there.
      const containerLogsOutcome = await runGateCommand({
        command: 'docker',
        commandArguments: ['logs', resources.containerName],
        workingDirectoryPath: hearthkitWorkspaceRootPath,
      })
      containerLoggedStartupMessage =
        `${containerLogsOutcome.standardOutput}${containerLogsOutcome.standardError}`.includes(
          appStartupLogMessage,
        )
    }

    return {
      outcome: {
        projectDirectoryPath,
        resolvedPackages: [...resolvedPackages],
        organizationsEnabled: created.organizationsEnabled,
        installExitCode: installOutcome.exitCode,
        typecheckExitCode: typecheckOutcome.exitCode,
        buildExitCode: buildOutcome.exitCode,
        healthStatusCode,
        playwrightExitCode,
        playwrightTestOutcomes,
        containerHealthStatusCode,
        containerLoggedStartupMessage,
      },
      tearDown,
    }
  } catch (error) {
    await tearDown()
    throw error
  }
}
