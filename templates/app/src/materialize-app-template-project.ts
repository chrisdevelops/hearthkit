import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  appTemplateRequiredPackageNames,
  appTemplateWorkspaceDependencySpecifier,
  appVerifyContainerFailedErrorPrefix,
} from './app-template-contract.ts'
import { runVerifyCommand } from './run-verify-command.ts'

/**
 * Step one of `verify:container`: turn `templates/app` into a self-contained project directory that
 * installs and builds with no workspace behind it.
 *
 * The scaffolding itself is `@hearthkit/create`, run against the live template with an EMPTY
 * optional-package selection (completion plan 3.2). It used to be a second copy of the copy walk
 * here, which meant a drift between what `verify:container` proved and what a user actually gets.
 * Now the only thing this file adds is what `create` deliberately does not do: pack the workspace
 * packages into the project so its dependencies resolve from inside the directory.
 *
 * It runs `create` as a CHILD PROCESS reached through the workspace root rather than importing it,
 * and neither half of that is a style choice.
 *
 * An IMPORT would pull `@hearthkit/create` and, through it, `@hearthkit/cli` into this project's
 * TypeScript program, where `next-env.d.ts` makes `NODE_ENV` a REQUIRED member of
 * `NodeJS.ProcessEnv` (`next/types/global.d.ts`). Every `spawn({ env })` in the CLI then fails to
 * typecheck against a plain environment record, in a package that typechecks cleanly on its own. A
 * Next app's program has no business holding a Node CLI's source, so the boundary is a process.
 *
 * A WORKSPACE PATH rather than a dev dependency, because `@hearthkit/create` is not in the template
 * contract's `appTemplateRepoOnlyDependencyNames`: declaring it would carry it into every generated
 * project's `devDependencies`, and the tarball rewrite below would then have nothing to point it at.
 * `packWorkspacePackage` already reaches into the workspace by path for the same reason.
 *
 * Inside the workspace the bin's own default template directory IS this directory, which is how the
 * live template rather than a bundled copy is what gets scaffolded.
 *
 * Empty rather than the superset keeps this a Docker-only structural check rather than one needing
 * Postgres, MinIO, Mailpit and a Stripe key. The cost is stated in CONTRACT.md: this command never
 * exercises a section. The three scaffold variants in `@hearthkit/create` do.
 *
 * The tarballs are written *inside* the project because the image build copies the project and
 * installs from within the container: a dependency resolved through a path outside the directory, or
 * through a symlink escaping it, would drop those packages from `.next/standalone`.
 */

/** Directory the packed workspace tarballs are written into, inside the materialized project; create never copies it. */
export const packedPackagesDirectoryName = 'hearthkit-packages'

/** Path of @hearthkit/create's bin inside the workspace, relative to the workspace root; the same shape packWorkspacePackage already uses to find a package. */
const createProjectBinWorkspacePath = 'packages/create/src/create-bin.ts'

/** Optional-package selection this command materializes: none, which is the tree a project that picked nothing gets. */
const materializedOptionalPackageSelection = ''

/** Where the materialized project ended up, and which tarballs its dependencies now point at. */
export type MaterializedAppTemplateProject = {
  projectDirectoryPath: string
  packedTarballFileNames: string[]
}

/** Inputs of materializeAppTemplateProject; the destination directory must not already exist or must be empty. */
export type MaterializeAppTemplateProjectOptions = {
  templateDirectoryPath: string
  workspaceRootPath: string
  projectDirectoryPath: string
  projectName: string
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

/**
 * Points every `@hearthkit/*` dependency create wrote at a tarball inside the project.
 *
 * create writes one `packageVersion` string, which is right for a published install and useless here,
 * because N packages need N different tarball paths. Everything else about the manifest — the name,
 * the deleted repo-only entries, the pruned sections, the `dev` script — is create's work and is left
 * exactly as it wrote it.
 *
 * The same map is written again under `pnpm.overrides`, and that half is not belt and braces. Since
 * `@hearthkit/config` became a runtime dependency of `@hearthkit/observability`, `pnpm pack` rewrites
 * that `workspace:*` to `0.0.0` inside the tarball, and pnpm then tries to fetch `@hearthkit/config`
 * from the registry, where nothing is published yet, and the install dies on a 404. Overrides catch
 * the transitive reference as well as the direct one, which is the mechanism the scaffold gates in
 * `@hearthkit/create` already use for the same reason.
 */
async function pointHearthkitDependenciesAtTarballs(
  projectDirectoryPath: string,
  tarballFileNameByPackageName: ReadonlyMap<string, string>,
): Promise<void> {
  const manifestPath = join(projectDirectoryPath, 'package.json')
  const parsedManifest: unknown = JSON.parse(await readFile(manifestPath, 'utf8'))
  const manifest = jsonObjectOf(parsedManifest, manifestPath)

  const dependencies = manifestSectionOf(manifest, 'dependencies')
  const devDependencies = manifestSectionOf(manifest, 'devDependencies')

  for (const specifierMap of [dependencies, devDependencies]) {
    for (const dependencyName of Object.keys(specifierMap)) {
      if (!dependencyName.startsWith('@hearthkit/')) {
        continue
      }
      const tarballFileName = tarballFileNameByPackageName.get(dependencyName)
      if (tarballFileName === undefined) {
        throw new Error(
          `${appVerifyContainerFailedErrorPrefix} no packed tarball for ${dependencyName}, which the materialized project still depends on`,
        )
      }
      specifierMap[dependencyName] = `file:./${packedPackagesDirectoryName}/${tarballFileName}`
    }
  }

  // A workspace specifier surviving anywhere would resolve to nothing outside the workspace, which is
  // the whole failure this materialization exists to rule out.
  const survivingWorkspaceSpecifiers = [
    ...Object.entries(dependencies),
    ...Object.entries(devDependencies),
  ].filter(([, specifier]) => specifier === appTemplateWorkspaceDependencySpecifier)
  if (survivingWorkspaceSpecifiers.length > 0) {
    throw new Error(
      `${appVerifyContainerFailedErrorPrefix} ${survivingWorkspaceSpecifiers.map(([name]) => name).join(', ')} still resolve through the workspace after scaffolding`,
    )
  }

  const pnpmSection = manifest.pnpm
  manifest.pnpm = {
    ...(typeof pnpmSection === 'object' && pnpmSection !== null ? pnpmSection : {}),
    overrides: Object.fromEntries(
      [...tarballFileNameByPackageName].map(([packageName, tarballFileName]) => [
        packageName,
        `file:./${packedPackagesDirectoryName}/${tarballFileName}`,
      ]),
    ),
  }
  manifest.dependencies = dependencies
  manifest.devDependencies = devDependencies

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

/** Scaffolds the template into a fresh directory with @hearthkit/create, then makes its dependencies resolve from inside it. */
export async function materializeAppTemplateProject(
  options: MaterializeAppTemplateProjectOptions,
): Promise<MaterializedAppTemplateProject> {
  const created = await runVerifyCommand({
    command: process.execPath,
    commandArguments: [
      join(options.workspaceRootPath, ...createProjectBinWorkspacePath.split('/')),
      options.projectName,
      '--packages',
      materializedOptionalPackageSelection,
      '--target-directory',
      options.projectDirectoryPath,
      '--no-install',
      '--no-start-infra',
      '--no-interactive',
    ],
    workingDirectoryPath: options.templateDirectoryPath,
    streamOutput: true,
  })
  if (created.exitCode !== 0) {
    throw new Error(
      `${appVerifyContainerFailedErrorPrefix} ${createProjectBinWorkspacePath} exited ${String(created.exitCode)}: ${created.stderr.trim()}`,
    )
  }

  await mkdir(join(options.projectDirectoryPath, packedPackagesDirectoryName), { recursive: true })
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

  await pointHearthkitDependenciesAtTarballs(
    options.projectDirectoryPath,
    tarballFileNameByPackageName,
  )

  return {
    projectDirectoryPath: options.projectDirectoryPath,
    packedTarballFileNames: [...tarballFileNameByPackageName.values()],
  }
}
