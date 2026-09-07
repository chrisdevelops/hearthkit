import { mkdir, copyFile, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  appTemplateGuaranteedScriptNames,
  appTemplateOptionalPackageNames,
  appTemplateRenamedPaths,
  appTemplateRepoOnlyDependencyNames,
  appTemplateRepoOnlyScriptNames,
  appTemplateRequiredPackageNames,
  appTemplateSectionBlockBeginPrefix,
  appTemplateSectionBlockEndPrefix,
  appTemplateSectionsByOptionalPackage,
  appTemplateWorkspaceDependencySpecifier,
  appVerifyContainerFailedErrorPrefix,
  type AppTemplateOptionalPackageName,
} from './app-template-contract.ts'
import {
  decideTemplatePathPrune,
  packedPackagesDirectoryName,
} from './decide-template-path-prune.ts'
import { pruneOptionalSectionBlocks } from './prune-optional-section-blocks.ts'
import { runVerifyCommand } from './run-verify-command.ts'

/**
 * Step one of `verify:container`: turn `templates/app` into a self-contained project directory that
 * installs and builds with no workspace behind it. This is a dry run of what `@hearthkit/create`
 * does when it scaffolds, from the same lists, which is why it prunes and rewrites rather than
 * copying the tree wholesale.
 *
 * It materializes with an EMPTY optional-package selection, not the superset. That keeps this a
 * Docker-only structural check rather than one needing Postgres, MinIO, Mailpit and a Stripe key, and
 * it makes the empty-selection prune the thing this command exercises on every invocation — which is
 * the strongest available check that the always-on project is still exactly what it was. The cost is
 * stated in CONTRACT.md: this command never exercises a section.
 *
 * The hearthkit packages arrive as tarballs written *inside* the project, because the image build
 * copies the project and installs from within the container: a dependency resolved through a path
 * outside the directory, or through a symlink escaping it, would drop those packages from
 * `.next/standalone`.
 */

/** The two pruning halves Phase 6 consumes, re-exported by name so both are reachable from one module. */
export { decideTemplatePathPrune } from './decide-template-path-prune.ts'
export { pruneOptionalSectionBlocks } from './prune-optional-section-blocks.ts'

/** Optional-package selection this command materializes: none, which is the tree a project that picked nothing gets. */
const materializedOptionalPackageNames: readonly AppTemplateOptionalPackageName[] = []

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

/** The name a template file is written under in a generated project; only the ignore file changes. */
function generatedProjectPathOf(relativePath: string): string {
  return (
    appTemplateRenamedPaths.find((rename) => rename.templatePath === relativePath)
      ?.generatedProjectPath ?? relativePath
  )
}

/**
 * Copies one file, pruning its marked blocks when it holds any.
 *
 * A file with no marker text is copied byte for byte rather than round-tripped through a string, so
 * nothing here can corrupt a file this template later adds that is not UTF-8 text.
 */
async function copyTemplateFile(
  sourceFilePath: string,
  destinationFilePath: string,
): Promise<void> {
  await mkdir(dirname(destinationFilePath), { recursive: true })

  const fileText = await readFile(sourceFilePath, 'utf8')
  if (
    !fileText.includes(appTemplateSectionBlockBeginPrefix) &&
    !fileText.includes(appTemplateSectionBlockEndPrefix)
  ) {
    await copyFile(sourceFilePath, destinationFilePath)
    return
  }

  await writeFile(
    destinationFilePath,
    pruneOptionalSectionBlocks({
      fileText,
      selectedOptionalPackageNames: materializedOptionalPackageNames,
    }),
    'utf8',
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
    if (
      decideTemplatePathPrune({
        templateRelativePath: relativePath,
        selectedOptionalPackageNames: materializedOptionalPackageNames,
      }).kind !== 'template-path-copied'
    ) {
      continue
    }

    if (entry.isDirectory()) {
      // The directory itself is created by the first file written into it, so a section whose files
      // were all pruned leaves no empty directory behind.
      await copyTemplateTree(templateDirectoryPath, projectDirectoryPath, relativePath)
      continue
    }

    if (entry.isFile()) {
      await copyTemplateFile(
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

/** Every optional package the materialized selection leaves out, whose manifest entries are deleted. */
function unselectedOptionalPackageNames(): AppTemplateOptionalPackageName[] {
  return appTemplateOptionalPackageNames.filter(
    (optionalPackageName) => !materializedOptionalPackageNames.includes(optionalPackageName),
  )
}

/**
 * Applies the two manifest rewrites the optional packages own: an unselected package's dependencies
 * and dev dependencies go, and so do the scripts it adds. `dev` is the one script whose VALUE the
 * selection changes rather than one a package adds, so it is set rather than deleted.
 */
function deleteUnselectedOptionalManifestEntries(
  dependencies: Record<string, string>,
  devDependencies: Record<string, string>,
  scripts: Record<string, string>,
): void {
  for (const optionalPackageName of unselectedOptionalPackageNames()) {
    const section = appTemplateSectionsByOptionalPackage[optionalPackageName]
    for (const dependencyName of section.hearthkitDependencyNames) {
      delete dependencies[dependencyName]
    }
    for (const devDependencyName of section.devDependencyNames) {
      delete devDependencies[devDependencyName]
    }
    for (const scriptName of section.packageScriptNames) {
      if (!(appTemplateGuaranteedScriptNames as readonly string[]).includes(scriptName)) {
        delete scripts[scriptName]
      }
    }
  }

  scripts.dev = materializedOptionalPackageNames.length === 0 ? 'next dev' : 'hearthkit dev'
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

  const devDependencies = manifestSectionOf(manifest, 'devDependencies')
  for (const dependencyName of appTemplateRepoOnlyDependencyNames) {
    delete devDependencies[dependencyName]
  }

  const dependencies = manifestSectionOf(manifest, 'dependencies')
  deleteUnselectedOptionalManifestEntries(dependencies, devDependencies, scripts)

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

  // A workspace specifier surviving anywhere would resolve to nothing outside the workspace, which is
  // the whole failure this materialization exists to rule out.
  const survivingWorkspaceSpecifiers = [
    ...Object.entries(dependencies),
    ...Object.entries(devDependencies),
  ].filter(([, specifier]) => specifier === appTemplateWorkspaceDependencySpecifier)
  if (survivingWorkspaceSpecifiers.length > 0) {
    throw new Error(
      `${appVerifyContainerFailedErrorPrefix} ${survivingWorkspaceSpecifiers.map(([name]) => name).join(', ')} still resolve through the workspace after pruning`,
    )
  }

  manifest.scripts = scripts
  manifest.dependencies = dependencies
  manifest.devDependencies = devDependencies

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

/**
 * Copies the template into a fresh directory with the repo-only files dropped, every optional
 * package's owned paths and marked blocks removed, the renames applied, the repo-only scripts and
 * dev dependencies deleted, and every `workspace:*` specifier replaced by a tarball that resolves
 * from inside the directory.
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
