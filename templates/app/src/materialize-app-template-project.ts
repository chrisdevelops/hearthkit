import { mkdir, copyFile, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  appTemplateNeverCopiedDirectoryNames,
  appTemplateRenamedPaths,
  appTemplateRepoOnlyDependencyNames,
  appTemplateRepoOnlyDirectoryNames,
  appTemplateRepoOnlyPaths,
  appTemplateRepoOnlyScriptNames,
  appTemplateRequiredPackageNames,
  appTemplateWorkspaceDependencySpecifier,
  appVerifyContainerFailedErrorPrefix,
} from './app-template-contract.ts'
import { runVerifyCommand } from './run-verify-command.ts'

/**
 * Step one of `verify:container`: turn `templates/app` into a self-contained project directory that
 * installs and builds with no workspace behind it. This is a dry run of what `@hearthkit/create`
 * does when it scaffolds, from the same lists, which is why it prunes and rewrites rather than
 * copying the tree wholesale.
 *
 * The hearthkit packages arrive as tarballs written *inside* the project, because the image build
 * copies the project and installs from within the container: a dependency resolved through a path
 * outside the directory, or through a symlink escaping it, would drop those packages from
 * `.next/standalone`.
 */

/** Directory inside the materialized project holding the packed hearthkit tarballs the install resolves. */
const packedPackagesDirectoryName = 'hearthkit-packages'

/** Where the materialized project ended up, and which tarballs its dependencies now point at. */
export type MaterializedAppTemplateProject = {
  projectDirectoryPath: string
  packedTarballFileNames: string[]
}

/** Inputs of materializeAppTemplateProject; the destination directory must not already exist. */
export type MaterializeAppTemplateProjectOptions = {
  templateDirectoryPath: string
  workspaceRootPath: string
  projectDirectoryPath: string
  projectName: string
}

/** True when this relative path is pruned rather than copied into a generated project. */
function isPrunedTemplatePath(relativePath: string): boolean {
  const [firstSegment = ''] = relativePath.split('/')

  return (
    appTemplateNeverCopiedDirectoryNames.some((directoryName) => directoryName === firstSegment) ||
    appTemplateRepoOnlyDirectoryNames.some((directoryName) => directoryName === firstSegment) ||
    appTemplateRepoOnlyPaths.some((repoOnlyPath) => repoOnlyPath === relativePath) ||
    firstSegment === '.git' ||
    firstSegment === packedPackagesDirectoryName
  )
}

/** The name a template file is written under in a generated project; only the ignore file changes. */
function generatedProjectPathOf(relativePath: string): string {
  return (
    appTemplateRenamedPaths.find((rename) => rename.templatePath === relativePath)
      ?.generatedProjectPath ?? relativePath
  )
}

/** Copies the template tree into the destination, dropping every pruned path and applying the renames. */
async function copyTemplateTree(
  templateDirectoryPath: string,
  projectDirectoryPath: string,
  relativePrefix: string,
): Promise<void> {
  const sourceDirectoryPath =
    relativePrefix === ''
      ? templateDirectoryPath
      : join(templateDirectoryPath, ...relativePrefix.split('/'))

  for (const entry of await readdir(sourceDirectoryPath, { withFileTypes: true })) {
    const relativePath = relativePrefix === '' ? entry.name : `${relativePrefix}/${entry.name}`
    if (isPrunedTemplatePath(relativePath)) {
      continue
    }

    if (entry.isDirectory()) {
      await mkdir(join(projectDirectoryPath, ...relativePath.split('/')), { recursive: true })
      await copyTemplateTree(templateDirectoryPath, projectDirectoryPath, relativePath)
      continue
    }

    if (entry.isFile()) {
      await copyFile(
        join(sourceDirectoryPath, entry.name),
        join(projectDirectoryPath, ...generatedProjectPathOf(relativePath).split('/')),
      )
    }
  }
}

/** Packs one workspace package into the project and answers the tarball file name pnpm wrote. */
async function packWorkspacePackage(
  workspaceRootPath: string,
  projectDirectoryPath: string,
  packageName: string,
): Promise<string> {
  const packageDirectoryName = packageName.replace('@hearthkit/', '')
  const packageDirectoryPath = join(workspaceRootPath, 'packages', packageDirectoryName)
  const packDestinationPath = join(projectDirectoryPath, packedPackagesDirectoryName)

  const packResult = await runVerifyCommand({
    command: 'pnpm',
    commandArguments: ['pack', '--pack-destination', packDestinationPath],
    workingDirectoryPath: packageDirectoryPath,
  })

  if (packResult.exitCode !== 0) {
    throw new Error(
      `${appVerifyContainerFailedErrorPrefix} pnpm pack exited ${String(packResult.exitCode)} for ${packageName}: ${packResult.stderr.trim()}`,
    )
  }

  const tarballFileNames = (await readdir(packDestinationPath)).filter((fileName) =>
    fileName.startsWith(`hearthkit-${packageDirectoryName}-`),
  )
  const [tarballFileName] = tarballFileNames
  if (tarballFileName === undefined) {
    throw new Error(
      `${appVerifyContainerFailedErrorPrefix} pnpm pack wrote no tarball for ${packageName} in ${packDestinationPath}`,
    )
  }

  return tarballFileName
}

/** A parsed JSON object, or a thrown error naming the file that did not hold one. */
function jsonObjectOf(parsedJson: unknown, sourceLabel: string): Record<string, unknown> {
  if (typeof parsedJson !== 'object' || parsedJson === null || Array.isArray(parsedJson)) {
    throw new Error(`${appVerifyContainerFailedErrorPrefix} ${sourceLabel} holds no JSON object`)
  }
  return { ...parsedJson }
}

/** The string-valued entries of one manifest section, as a fresh record safe to edit and write back. */
function manifestSectionOf(
  manifest: Record<string, unknown>,
  sectionName: string,
): Record<string, string> {
  const section = manifest[sectionName]
  const stringEntries: Record<string, string> = {}

  if (typeof section === 'object' && section !== null && !Array.isArray(section)) {
    for (const [entryName, entryValue] of Object.entries(section)) {
      if (typeof entryValue === 'string') {
        stringEntries[entryName] = entryValue
      }
    }
  }

  return stringEntries
}

/** Reads the project manifest, applies every scaffold rewrite, and writes it back. */
async function rewriteProjectPackageJson(
  projectDirectoryPath: string,
  projectName: string,
  tarballFileNameByPackageName: ReadonlyMap<string, string>,
): Promise<void> {
  const manifestPath = join(projectDirectoryPath, 'package.json')
  const parsedManifest: unknown = JSON.parse(await readFile(manifestPath, 'utf8'))
  const manifest = jsonObjectOf(parsedManifest, manifestPath)

  manifest.name = projectName

  const scripts = manifestSectionOf(manifest, 'scripts')
  for (const scriptName of appTemplateRepoOnlyScriptNames) {
    delete scripts[scriptName]
  }
  manifest.scripts = scripts

  const devDependencies = manifestSectionOf(manifest, 'devDependencies')
  for (const dependencyName of appTemplateRepoOnlyDependencyNames) {
    delete devDependencies[dependencyName]
  }
  manifest.devDependencies = devDependencies

  const dependencies = manifestSectionOf(manifest, 'dependencies')
  for (const packageName of appTemplateRequiredPackageNames) {
    if (dependencies[packageName] !== appTemplateWorkspaceDependencySpecifier) {
      throw new Error(
        `${appVerifyContainerFailedErrorPrefix} ${packageName} is not declared at ${appTemplateWorkspaceDependencySpecifier} in templates/app/package.json`,
      )
    }
    const tarballFileName = tarballFileNameByPackageName.get(packageName)
    if (tarballFileName === undefined) {
      throw new Error(`${appVerifyContainerFailedErrorPrefix} no packed tarball for ${packageName}`)
    }
    dependencies[packageName] = `file:./${packedPackagesDirectoryName}/${tarballFileName}`
  }
  manifest.dependencies = dependencies

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

/**
 * Copies the template into a fresh directory with the repo-only files dropped, the renames applied,
 * the repo-only scripts and dev dependencies deleted, and every `workspace:*` specifier replaced by
 * a tarball that resolves from inside the directory.
 */
export async function materializeAppTemplateProject(
  options: MaterializeAppTemplateProjectOptions,
): Promise<MaterializedAppTemplateProject> {
  await mkdir(join(options.projectDirectoryPath, packedPackagesDirectoryName), { recursive: true })
  await copyTemplateTree(options.templateDirectoryPath, options.projectDirectoryPath, '')

  const tarballFileNameByPackageName = new Map<string, string>()
  for (const packageName of appTemplateRequiredPackageNames) {
    tarballFileNameByPackageName.set(
      packageName,
      await packWorkspacePackage(
        options.workspaceRootPath,
        options.projectDirectoryPath,
        packageName,
      ),
    )
  }

  await rewriteProjectPackageJson(
    options.projectDirectoryPath,
    options.projectName,
    tarballFileNameByPackageName,
  )

  return {
    projectDirectoryPath: options.projectDirectoryPath,
    packedTarballFileNames: [...tarballFileNameByPackageName.values()],
  }
}
