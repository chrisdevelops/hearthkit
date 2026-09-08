import { mkdir, readdir } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import {
  defaultAppTemplateDirectoryPath,
  loadAppTemplateSectionManifest,
} from './app-template-section-manifest.ts'
import { buildProjectNextSteps } from './build-project-next-steps.ts'
import { copyPrunedTemplateTree } from './copy-pruned-template-tree.ts'
import {
  hearthkitCreateOptionsSchema,
  hearthkitProjectNameSchema,
  type CreateHearthkitProject,
  type CreateHearthkitProjectResult,
  type ResolvedHearthkitPackageName,
} from './create-contract.ts'
import {
  createOptionMissingFailure,
  createOrganizationsWithoutAuthFailure,
  createPackageUnknownFailure,
  createProjectNameInvalidFailure,
  createTargetNotEmptyFailure,
} from './create-failure-results.ts'
import { promptForMissingCreateOptions } from './prompt-for-missing-create-options.ts'
import { resolveSelectedHearthkitPackages } from './resolve-selected-hearthkit-packages.ts'
import { createPackageVersion } from './resolve-create-package-version.ts'
import { rewriteGeneratedPackageManifest } from './rewrite-generated-package-manifest.ts'
import { runScaffoldCommands } from './run-scaffold-commands.ts'
import {
  deriveInfraServicesFor,
  writeGeneratedProjectFiles,
} from './write-generated-project-files.ts'

/**
 * Scaffold a new project from the app template.
 *
 * The seven steps run in order and stop at the first failure. Nothing is written before step three,
 * and nothing is ever deleted: after a failing install or a failing `dev infra up` the tree stays on
 * disk so the user can fix the cause and rerun the one command by hand.
 */

/** Writes one next-steps line; the same lines come back as nextSteps, so a script may read either. */
function printNextStepLine(nextStepLine: string): void {
  process.stdout.write(`${nextStepLine}\n`)
}

/** True when the path exists and holds at least one entry; an absent directory is a fine target. */
async function directoryHoldsAnyEntry(directoryPath: string): Promise<boolean> {
  return readdir(directoryPath).then(
    (entries) => entries.length > 0,
    () => false,
  )
}

/** Whether the resolved set means a database is created; db is the only package that implies one. */
function resolvedSetCreatesDatabase(
  resolvedPackages: readonly ResolvedHearthkitPackageName[],
): boolean {
  return resolvedPackages.includes('db')
}

/** Scaffolds one project and reports the tree it wrote and the commands it ran, or the failure that stopped it. */
export const createHearthkitProject: CreateHearthkitProject = async (rawOptions) => {
  const options = hearthkitCreateOptionsSchema.parse(rawOptions)
  // Node types isTTY as a boolean but leaves it undefined on a pipe, which is falsy and is exactly
  // the answer wanted: no terminal means no prompting unless --interactive said otherwise.
  const interactive = options.interactive ?? process.stdin.isTTY

  const answered = interactive
    ? await promptForMissingCreateOptions({
        projectName: options.projectName,
        packages: options.packages,
      })
    : { projectName: options.projectName, packages: options.packages }

  if (answered.projectName === undefined) {
    return createOptionMissingFailure('projectName')
  }
  if (answered.packages === undefined) {
    return createOptionMissingFailure('packages')
  }

  // Step 1: validate. Nothing below this point can be reached by a name or a package list that the
  // schemas refuse, which is why no directory has been touched yet.
  const parsedProjectName = hearthkitProjectNameSchema.safeParse(answered.projectName)
  if (!parsedProjectName.success) {
    return createProjectNameInvalidFailure(answered.projectName)
  }
  const projectName = String(parsedProjectName.data)

  // Step 2: resolve. auth pulls db and email; payments pulls auth and therefore both of those.
  const packageResolution = resolveSelectedHearthkitPackages(answered.packages)
  if (packageResolution.kind === 'hearthkit-packages-unknown') {
    return createPackageUnknownFailure(packageResolution.unknownPackageNames)
  }
  const { resolvedPackages, selectedSectionPackageNames } = packageResolution

  // Checked after resolution, so payments with organizations is valid: payments pulls auth in.
  const organizationsEnabled = options.organizations
  if (organizationsEnabled && !resolvedPackages.includes('auth')) {
    return createOrganizationsWithoutAuthFailure(resolvedPackages)
  }

  // Step 3: check the target.
  const givenTargetDirectory = options.targetDirectory ?? `./${projectName}`
  const projectDirectoryPath = isAbsolute(givenTargetDirectory)
    ? givenTargetDirectory
    : resolve(process.cwd(), givenTargetDirectory)
  if (await directoryHoldsAnyEntry(projectDirectoryPath)) {
    return createTargetNotEmptyFailure(projectDirectoryPath)
  }

  // Step 4: copy and prune the template, then apply the manifest's rewrite targets.
  const templateDirectoryPath = options.templateDirectoryPath ?? defaultAppTemplateDirectoryPath
  const templateSectionManifest = await loadAppTemplateSectionManifest(templateDirectoryPath)
  await mkdir(projectDirectoryPath, { recursive: true })
  const copiedTree = await copyPrunedTemplateTree({
    templateDirectoryPath,
    projectDirectoryPath,
    selectedSectionPackageNames,
    organizationsEnabled,
    templateSectionManifest,
  })
  await rewriteGeneratedPackageManifest({
    projectDirectoryPath,
    projectName,
    packageVersion: options.packageVersion ?? createPackageVersion,
    selectedSectionPackageNames,
    templateSectionManifest,
  })

  // Step 5: write the files the template does not carry.
  const generatedPaths = await writeGeneratedProjectFiles({
    projectDirectoryPath,
    projectName,
    resolvedPackages,
  })
  const writtenPaths = [...copiedTree.writtenProjectPaths, ...generatedPaths].toSorted()

  // Step 6: run the commands, stopping at the first failure with the tree left on disk.
  const commandsOutcome = await runScaffoldCommands({
    projectDirectoryPath,
    projectName,
    install: options.install,
    startInfra: options.startInfra,
    infraServices: deriveInfraServicesFor(resolvedPackages),
    createsDatabase: resolvedSetCreatesDatabase(resolvedPackages),
  })
  if (commandsOutcome.kind === 'scaffold-command-failed') {
    return commandsOutcome.failure
  }

  // Step 7: print the next steps, which is where the one-time connection string and the derived
  // bucket name reach the user, since create writes no .env.
  const nextSteps = buildProjectNextSteps({
    projectName,
    projectDirectoryPath,
    resolvedPackages,
    commandsRun: commandsOutcome.commandsRun,
  })
  for (const nextStepLine of nextSteps) {
    printNextStepLine(nextStepLine)
  }

  const created: CreateHearthkitProjectResult = {
    kind: 'hearthkit-project-created',
    projectName: parsedProjectName.data,
    projectDirectoryPath,
    resolvedPackages,
    organizationsEnabled,
    writtenPaths,
    commandsRun: commandsOutcome.commandsRun,
    nextSteps,
  }
  return created
}
