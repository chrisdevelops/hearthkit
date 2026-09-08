import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AppTemplateSectionManifest } from './app-template-section-manifest.ts'

/**
 * The nine package.json rewrites, all of them a rename, a specifier swap or a deletion.
 *
 * Two ownership rules from the template's manifest apply here and they differ. A path or an
 * environment variable belongs to exactly one package, but a dependency, a dev dependency and a
 * script are UNIONED across the selected packages: `@hearthkit/cli` is a dev dependency of all four
 * sections, so deleting it because payments was not selected would take it away from auth as well.
 * Every deletion below therefore keeps whatever a selected section still contributes.
 */

/** Everything one manifest rewrite needs; packageVersion is written verbatim, whether it is a range or a file: path. */
export type RewriteGeneratedPackageManifestOptions = {
  projectDirectoryPath: string
  projectName: string
  packageVersion: string
  selectedSectionPackageNames: readonly string[]
  templateSectionManifest: AppTemplateSectionManifest
}

/** A parsed JSON object, or a thrown error naming the file that did not hold one. */
function jsonObjectOf(parsedJson: unknown, sourceLabel: string): Record<string, unknown> {
  if (typeof parsedJson !== 'object' || parsedJson === null || Array.isArray(parsedJson)) {
    throw new Error(
      `hearthkit create generated manifest invalid: ${sourceLabel} holds no JSON object`,
    )
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

/** The union of one list across every selected section; what an unselected section may not take away. */
function namesContributedBySelectedSections(
  options: RewriteGeneratedPackageManifestOptions,
  listName: 'hearthkitDependencyNames' | 'devDependencyNames' | 'packageScriptNames',
): Set<string> {
  return new Set(
    options.selectedSectionPackageNames.flatMap(
      (sectionPackageName) =>
        options.templateSectionManifest.appTemplateSectionsByOptionalPackage[sectionPackageName]?.[
          listName
        ] ?? [],
    ),
  )
}

/** Deletes what the unselected sections own from the three manifest maps, keeping anything a selected section also contributes. */
function deleteUnselectedSectionEntries(
  options: RewriteGeneratedPackageManifestOptions,
  dependencies: Record<string, string>,
  devDependencies: Record<string, string>,
  scripts: Record<string, string>,
): void {
  const keptDependencyNames = namesContributedBySelectedSections(
    options,
    'hearthkitDependencyNames',
  )
  const keptDevDependencyNames = namesContributedBySelectedSections(options, 'devDependencyNames')
  const keptScriptNames = namesContributedBySelectedSections(options, 'packageScriptNames')

  const unselectedSectionPackageNames =
    options.templateSectionManifest.appTemplateOptionalPackageNames.filter(
      (sectionPackageName) => !options.selectedSectionPackageNames.includes(sectionPackageName),
    )

  for (const sectionPackageName of unselectedSectionPackageNames) {
    const section =
      options.templateSectionManifest.appTemplateSectionsByOptionalPackage[sectionPackageName]
    if (section === undefined) {
      continue
    }
    for (const dependencyName of section.hearthkitDependencyNames) {
      if (!keptDependencyNames.has(dependencyName)) {
        delete dependencies[dependencyName]
      }
    }
    for (const devDependencyName of section.devDependencyNames) {
      if (!keptDevDependencyNames.has(devDependencyName)) {
        delete devDependencies[devDependencyName]
      }
    }
    for (const scriptName of section.packageScriptNames) {
      const isGuaranteedScript =
        options.templateSectionManifest.appTemplateGuaranteedScriptNames.includes(scriptName)
      if (!isGuaranteedScript && !keptScriptNames.has(scriptName)) {
        delete scripts[scriptName]
      }
    }
  }
}

/** Applies every package.json rewrite the scaffold owes and writes the manifest back. */
export async function rewriteGeneratedPackageManifest(
  options: RewriteGeneratedPackageManifestOptions,
): Promise<void> {
  const { templateSectionManifest } = options
  const manifestPath = join(options.projectDirectoryPath, 'package.json')
  const parsedManifest: unknown = JSON.parse(await readFile(manifestPath, 'utf8'))
  const manifest = jsonObjectOf(parsedManifest, manifestPath)

  manifest.name = options.projectName

  const scripts = manifestSectionOf(manifest, 'scripts')
  for (const scriptName of templateSectionManifest.appTemplateRepoOnlyScriptNames) {
    delete scripts[scriptName]
  }

  const dependencies = manifestSectionOf(manifest, 'dependencies')
  const devDependencies = manifestSectionOf(manifest, 'devDependencies')
  for (const dependencyName of templateSectionManifest.appTemplateRepoOnlyDependencyNames) {
    delete dependencies[dependencyName]
    delete devDependencies[dependencyName]
  }

  deleteUnselectedSectionEntries(options, dependencies, devDependencies, scripts)

  // The one script whose VALUE the selection changes rather than one a section adds: a project with
  // no local infrastructure has no hearthkit binary to run it through.
  scripts.dev = options.selectedSectionPackageNames.length === 0 ? 'next dev' : 'hearthkit dev'

  for (const specifierMap of [dependencies, devDependencies]) {
    for (const [dependencyName, specifier] of Object.entries(specifierMap)) {
      if (specifier === templateSectionManifest.appTemplateWorkspaceDependencySpecifier) {
        specifierMap[dependencyName] = options.packageVersion
      }
    }
  }

  manifest.scripts = scripts
  manifest.dependencies = dependencies
  manifest.devDependencies = devDependencies

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}
