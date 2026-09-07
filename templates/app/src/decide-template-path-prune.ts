import {
  appTemplateNeverCopiedDirectoryNames,
  appTemplateOptionalPackageNames,
  appTemplateRepoOnlyDirectoryNames,
  appTemplateRepoOnlyPaths,
  appTemplateSectionsByOptionalPackage,
  type AppTemplateOptionalPackageName,
  type AppTemplatePruneDecision,
  type DecideTemplatePathPruneOptions,
} from './app-template-contract.ts'

/**
 * What happens to one path when the template is copied into a project.
 *
 * It replaces the boolean `isPrunedTemplatePath`, because a boolean has no room for the second
 * question `@hearthkit/create` asks: WHICH optional package caused a deletion. Pure and total, and it
 * reads nothing from disk, so a caller walking a directory decides every entry with it.
 *
 * An ABSENT `selectedOptionalPackageNames` means the superset — nothing is pruned for being optional,
 * which is the template itself. An EMPTY one means no optional package at all, which is the tree
 * `appGeneratedProjectGuaranteedPaths` describes. The two are never the same answer.
 */

/** Directory the verify harness writes the packed hearthkit tarballs into, inside the materialized project. */
export const packedPackagesDirectoryName = 'hearthkit-packages'

// Neither of these is part of the template artifact — one is the repository, one is scaffolding the
// verify harness writes inside the project it materialized — so neither joins
// appTemplateNeverCopiedDirectoryNames and both stay hardcoded here.
/** Directories never copied that no contract list names: the git repository and the harness's own tarball directory. */
const harnessOnlyDirectoryNames = ['.git', packedPackagesDirectoryName] as const

/** Which optional package owns each path it declares outright; exclusive, so one path answers with one name. */
const owningOptionalPackageByTemplatePath = new Map<string, AppTemplateOptionalPackageName>(
  appTemplateOptionalPackageNames.flatMap((optionalPackageName) =>
    appTemplateSectionsByOptionalPackage[optionalPackageName].ownedTemplatePaths.map(
      (ownedTemplatePath) => [ownedTemplatePath, optionalPackageName] as const,
    ),
  ),
)

/** True when the path is the named directory itself or sits anywhere inside it. */
function isUnderDirectory(templateRelativePath: string, directoryName: string): boolean {
  return (
    templateRelativePath === directoryName || templateRelativePath.startsWith(`${directoryName}/`)
  )
}

/** Decides one template path; only template-path-copied reaches a generated project. */
export function decideTemplatePathPrune(
  options: DecideTemplatePathPruneOptions,
): AppTemplatePruneDecision {
  const { templateRelativePath, selectedOptionalPackageNames } = options

  if (
    [...appTemplateNeverCopiedDirectoryNames, ...harnessOnlyDirectoryNames].some((directoryName) =>
      isUnderDirectory(templateRelativePath, directoryName),
    )
  ) {
    return { kind: 'template-path-never-copied' }
  }

  // Asked before the optional question on purpose: a hearthkit-only file answers the same whatever
  // the selection is, and deciding the optional question first would let CONTRACT.md fall through as
  // copied the moment a selection arrived.
  if (
    appTemplateRepoOnlyDirectoryNames.some((directoryName) =>
      isUnderDirectory(templateRelativePath, directoryName),
    ) ||
    (appTemplateRepoOnlyPaths as readonly string[]).includes(templateRelativePath)
  ) {
    return { kind: 'template-path-repo-only' }
  }

  const owningOptionalPackageName = owningOptionalPackageByTemplatePath.get(templateRelativePath)
  if (
    owningOptionalPackageName !== undefined &&
    selectedOptionalPackageNames !== undefined &&
    !selectedOptionalPackageNames.includes(owningOptionalPackageName)
  ) {
    return { kind: 'template-path-optional-package-unselected', owningOptionalPackageName }
  }

  return { kind: 'template-path-copied' }
}
