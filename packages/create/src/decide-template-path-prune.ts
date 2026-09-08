import {
  defaultAppTemplateSectionManifest,
  type AppTemplateSectionManifest,
} from './app-template-section-manifest.ts'

/**
 * What happens to one path when the template is copied into a project.
 *
 * A discriminated union rather than a boolean, because a boolean has no room for the second question
 * the copy walk asks: WHICH optional package caused a deletion. Pure and total, and it reads nothing
 * from disk, so a caller walking a directory decides every entry with it.
 *
 * An ABSENT `selectedOptionalPackageNames` means the superset — nothing is pruned for being optional,
 * which is the template itself. An EMPTY one means no optional package at all. The two are never the
 * same answer.
 */

/** Directory the scaffold harnesses write packed hearthkit tarballs into, inside the project they made. */
const packedPackagesDirectoryName = 'hearthkit-packages'

// Neither of these belongs to the template artifact — one is the repository, one is scaffolding a
// verify harness writes inside the project it materialized — so neither is in any manifest list and
// both stay here.
/** Directories never copied that no manifest list names: the git repository and the harness tarball directory. */
const harnessOnlyDirectoryNames = ['.git', packedPackagesDirectoryName] as const

/** What the pruner decided about one template path; only template-path-copied reaches a generated project. */
export type AppTemplatePruneDecision =
  | { kind: 'template-path-copied' }
  | { kind: 'template-path-never-copied' }
  | { kind: 'template-path-repo-only' }
  | { kind: 'template-path-optional-package-unselected'; owningOptionalPackageName: string }

/** Options for decideTemplatePathPrune; templateSectionManifest is how a scaffold run passes the manifest of the template it is copying rather than the default one. */
export type DecideTemplatePathPruneOptions = {
  templateRelativePath: string
  selectedOptionalPackageNames?: readonly string[]
  templateSectionManifest?: AppTemplateSectionManifest
}

/** True when the path is the named directory itself or sits anywhere inside it. */
function isUnderDirectory(templateRelativePath: string, directoryName: string): boolean {
  return (
    templateRelativePath === directoryName || templateRelativePath.startsWith(`${directoryName}/`)
  )
}

/** The last segment of a relative path, which is the name a never-copied file rule matches on wherever it sits. */
function fileNameOf(templateRelativePath: string): string {
  return templateRelativePath.slice(templateRelativePath.lastIndexOf('/') + 1)
}

/** One owner map per manifest, kept because the copy walk asks this question once per path in the tree. */
const owningPackageMapsByManifest = new WeakMap<AppTemplateSectionManifest, Map<string, string>>()

/** Which optional package owns each path it declares outright; exclusive, so one path answers with one name. */
function owningOptionalPackageByTemplatePath(
  manifest: AppTemplateSectionManifest,
): Map<string, string> {
  const cached = owningPackageMapsByManifest.get(manifest)
  if (cached !== undefined) {
    return cached
  }
  const owningPackageMap = new Map<string, string>(
    manifest.appTemplateOptionalPackageNames.flatMap((optionalPackageName) =>
      (
        manifest.appTemplateSectionsByOptionalPackage[optionalPackageName]?.ownedTemplatePaths ?? []
      ).map((ownedTemplatePath) => [ownedTemplatePath, optionalPackageName] as const),
    ),
  )
  owningPackageMapsByManifest.set(manifest, owningPackageMap)
  return owningPackageMap
}

/** Decides one template path against the template's own manifest; only template-path-copied reaches a generated project. */
export function decideTemplatePathPrune(
  options: DecideTemplatePathPruneOptions,
): AppTemplatePruneDecision {
  const { templateRelativePath, selectedOptionalPackageNames } = options
  const manifest = options.templateSectionManifest ?? defaultAppTemplateSectionManifest

  if (
    [...manifest.appTemplateNeverCopiedDirectoryNames, ...harnessOnlyDirectoryNames].some(
      (directoryName) => isUnderDirectory(templateRelativePath, directoryName),
    ) ||
    manifest.appTemplateNeverCopiedFileNames.includes(fileNameOf(templateRelativePath))
  ) {
    return { kind: 'template-path-never-copied' }
  }

  // Asked before the optional question on purpose: a hearthkit-only file answers the same whatever
  // the selection is, and deciding the optional question first would let CONTRACT.md fall through as
  // copied the moment a selection arrived.
  if (
    manifest.appTemplateRepoOnlyDirectoryNames.some((directoryName) =>
      isUnderDirectory(templateRelativePath, directoryName),
    ) ||
    manifest.appTemplateRepoOnlyPaths.includes(templateRelativePath)
  ) {
    return { kind: 'template-path-repo-only' }
  }

  const owningOptionalPackageName =
    owningOptionalPackageByTemplatePath(manifest).get(templateRelativePath)
  if (
    owningOptionalPackageName !== undefined &&
    selectedOptionalPackageNames !== undefined &&
    !selectedOptionalPackageNames.includes(owningOptionalPackageName)
  ) {
    return { kind: 'template-path-optional-package-unselected', owningOptionalPackageName }
  }

  return { kind: 'template-path-copied' }
}
