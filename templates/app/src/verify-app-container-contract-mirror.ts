import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * The values `verify:container` needs from `app-template-contract.ts`, mirrored instead of imported.
 *
 * The contract module imports `@hearthkit/ui`, whose package entry point resolves to `.tsx`, and
 * bare Node refuses that extension outright (`ERR_UNKNOWN_FILE_EXTENSION`); no flag changes it and
 * no runner that could is a declared dependency of this template. `verify:container` is run by
 * `node`, so it cannot import the contract at all.
 *
 * Every mirrored string below is checked against the contract's source text before the run starts,
 * so a renamed or reworded value fails loudly here rather than silently pruning the wrong files. A
 * value *added* to one of the contract's lists is not detectable this way: add it here in the same
 * change that adds it there.
 */

/** Absolute path of the contract module, read as text so its literals can be checked without importing it. */
const appTemplateContractFilePath = fileURLToPath(
  new URL('./app-template-contract.ts', import.meta.url),
)

/** Mirrors appTemplateRepoOnlyDirectoryNames: directories pruned before a project is generated. */
export const mirroredRepoOnlyDirectoryNames = ['src', 'test-fixtures'] as const

/** Mirrors appTemplateRepoOnlyPaths: files outside those directories that must never reach a project. */
export const mirroredRepoOnlyPaths = ['CONTRACT.md', 'vitest.config.mts'] as const

/** Mirrors appTemplateNeverCopiedDirectoryNames: build output and dependency directories, never copied. */
export const mirroredNeverCopiedDirectoryNames = [
  'node_modules',
  '.next',
  'test-results',
  'playwright-report',
] as const

/** Mirrors appTemplateRenamedPaths: files stored under one name here and written under another in a project. */
export const mirroredRenamedPaths = [
  { templatePath: 'gitignore', generatedProjectPath: '.gitignore' },
] as const

/** Mirrors appTemplateRepoOnlyScriptNames: package.json scripts deleted when the template is scaffolded. */
export const mirroredRepoOnlyScriptNames = ['test', 'verify:container'] as const

/** Mirrors appTemplateRepoOnlyDependencyNames: dev dependencies deleted when the template is scaffolded. */
export const mirroredRepoOnlyDependencyNames = ['vitest', 'zod'] as const

/** Mirrors appTemplateRequiredPackageNames: the hearthkit packages this template wires. */
export const mirroredRequiredPackageNames = [
  '@hearthkit/config',
  '@hearthkit/observability',
  '@hearthkit/ui',
] as const

/** Mirrors appTemplateWorkspaceDependencySpecifier: the specifier the scaffolder must replace. */
export const mirroredWorkspaceDependencySpecifier = 'workspace:*'

/** Mirrors appHealthRoutePath: the route the container healthcheck and this script poll. */
export const mirroredHealthRoutePath = '/health'

/** Mirrors appStartupLogMessage: the line a healthy boot writes to stdout exactly once. */
export const mirroredStartupLogMessage = 'hearthkit app started'

/** Mirrors appSmokeBaseUrlEnvVariableName: points the Playwright smoke test at the running container. */
export const mirroredSmokeBaseUrlEnvVariableName = 'SMOKE_TEST_BASE_URL'

/** Mirrors appImageBuildFailedErrorPrefix: the last stderr line when docker build exits nonzero. */
export const mirroredImageBuildFailedErrorPrefix = 'hearthkit app image build failed:'

/** Mirrors appContainerNotHealthyErrorPrefix: the last stderr line when /health never answers 200. */
export const mirroredContainerNotHealthyErrorPrefix = 'hearthkit app container not healthy:'

/** Mirrors appContainerDefaultPort: the port the container listens on inside its network namespace. */
export const mirroredContainerDefaultPort = 3000

/** Unique literal prefix of every verify:container failure that is not one of the contract's own. */
export const appVerifyContainerFailedErrorPrefix = 'hearthkit app verify container failed:'

/** Every mirrored string, paired with the contract export it copies, so the check can name what drifted. */
const mirroredStringsByContractExportName: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['appTemplateRepoOnlyDirectoryNames', mirroredRepoOnlyDirectoryNames],
  ['appTemplateRepoOnlyPaths', mirroredRepoOnlyPaths],
  ['appTemplateNeverCopiedDirectoryNames', mirroredNeverCopiedDirectoryNames],
  [
    'appTemplateRenamedPaths',
    mirroredRenamedPaths.flatMap((rename) => [rename.templatePath, rename.generatedProjectPath]),
  ],
  ['appTemplateRepoOnlyScriptNames', mirroredRepoOnlyScriptNames],
  ['appTemplateRepoOnlyDependencyNames', mirroredRepoOnlyDependencyNames],
  ['appTemplateRequiredPackageNames', mirroredRequiredPackageNames],
  ['appTemplateWorkspaceDependencySpecifier', [mirroredWorkspaceDependencySpecifier]],
  ['appHealthRoutePath', [mirroredHealthRoutePath]],
  ['appStartupLogMessage', [mirroredStartupLogMessage]],
  ['appSmokeBaseUrlEnvVariableName', [mirroredSmokeBaseUrlEnvVariableName]],
  ['appImageBuildFailedErrorPrefix', [mirroredImageBuildFailedErrorPrefix]],
  ['appContainerNotHealthyErrorPrefix', [mirroredContainerNotHealthyErrorPrefix]],
]

/**
 * Throws when a mirrored literal no longer appears in the contract's source text, which is the
 * cheapest formatting-independent way to catch a reworded prefix or a renamed path from here.
 */
export function assertMirroredContractValues(): void {
  const contractSource = readFileSync(appTemplateContractFilePath, 'utf8')

  const driftedValues = mirroredStringsByContractExportName.flatMap(
    ([contractExportName, mirroredValues]) =>
      mirroredValues
        .filter((mirroredValue) => !contractSource.includes(`'${mirroredValue}'`))
        .map((mirroredValue) => `${contractExportName} no longer holds '${mirroredValue}'`),
  )

  if (driftedValues.length > 0) {
    throw new Error(
      `${appVerifyContainerFailedErrorPrefix} verify-app-container-contract-mirror.ts has drifted from app-template-contract.ts: ${driftedValues.join('; ')}`,
    )
  }
}
