import { describe, expect, it } from 'vitest'
import { loadAppTemplatePruneEntry } from '../test-fixtures/app-template-prune-entry.ts'
import {
  appTemplateNeverCopiedDirectoryNames,
  appTemplateOptionalPackageNames,
  appTemplatePruneDecisionSchema,
  appTemplateRelativePathSchema,
  appTemplateRepoOnlyDirectoryNames,
  appTemplateRepoOnlyPaths,
  appTemplateSectionsByOptionalPackage,
  appTemplateVerifyContainerScriptPath,
  type AppTemplateOptionalPackageName,
  type AppTemplatePruneDecision,
} from './app-template-contract.ts'

/**
 * decideTemplatePathPrune replaces the boolean isPrunedTemplatePath, and the reason is the second
 * question a boolean has no room for: WHICH package caused a deletion. Every decision a gate reads
 * goes through appTemplatePruneDecisionSchema, so a plain string or a bare boolean fails here rather
 * than downstream in @hearthkit/create.
 */

const loadDecideTemplatePathPrune = async (): Promise<
  (options: {
    templateRelativePath: string
    selectedOptionalPackageNames?: readonly string[]
  }) => AppTemplatePruneDecision
> => {
  const { decideTemplatePathPrune } = await loadAppTemplatePruneEntry(
    () => import('./materialize-app-template-project.ts'),
  )
  return (options) => appTemplatePruneDecisionSchema.parse(decideTemplatePathPrune(options))
}

/** Every path any optional package owns, with the package that owns it. */
const ownedPathEntries = appTemplateOptionalPackageNames.flatMap((optionalPackageName) =>
  appTemplateSectionsByOptionalPackage[optionalPackageName].ownedTemplatePaths.map(
    (ownedTemplatePath) => ({ optionalPackageName, ownedTemplatePath }),
  ),
)

describe('decideTemplatePathPrune', () => {
  it('answers copied, never-copied and repo-only for the three kinds that have nothing to do with a selection', async () => {
    const decideTemplatePathPrune = await loadDecideTemplatePathPrune()

    // Only template-path-copied reaches a generated project.
    expect(decideTemplatePathPrune({ templateRelativePath: 'app/page.tsx' })).toEqual({
      kind: 'template-path-copied',
    })
    expect(
      decideTemplatePathPrune({
        templateRelativePath: 'app/page.tsx',
        selectedOptionalPackageNames: [],
      }),
    ).toEqual({ kind: 'template-path-copied' })

    for (const neverCopiedDirectoryName of appTemplateNeverCopiedDirectoryNames) {
      expect(
        decideTemplatePathPrune({
          templateRelativePath: `${neverCopiedDirectoryName}/anything.js`,
        }).kind,
        neverCopiedDirectoryName,
      ).toBe('template-path-never-copied')
    }

    for (const repoOnlyPath of [
      ...appTemplateRepoOnlyPaths,
      appTemplateVerifyContainerScriptPath,
      `${appTemplateRepoOnlyDirectoryNames[0]}/app-template-contract.ts`,
      `${appTemplateRepoOnlyDirectoryNames[1]}/app-template-tree-files.ts`,
    ]) {
      expect(
        decideTemplatePathPrune({ templateRelativePath: repoOnlyPath }).kind,
        repoOnlyPath,
      ).toBe('template-path-repo-only')
    }

    // A hearthkit-only file answers the same whatever the selection is. It is the selection argument
    // arriving that tempts an implementation to decide the optional question first and let a
    // repo-only path fall through as copied.
    expect(
      decideTemplatePathPrune({
        templateRelativePath: 'CONTRACT.md',
        selectedOptionalPackageNames: [],
      }).kind,
    ).toBe('template-path-repo-only')
  })

  it('names the owning package for every path an unselected optional package owns', async () => {
    const decideTemplatePathPrune = await loadDecideTemplatePathPrune()
    const wrongDecisions: string[] = []

    for (const { optionalPackageName, ownedTemplatePath } of ownedPathEntries) {
      const decision = decideTemplatePathPrune({
        templateRelativePath: ownedTemplatePath,
        selectedOptionalPackageNames: [],
      })
      if (
        decision.kind !== 'template-path-optional-package-unselected' ||
        decision.owningOptionalPackageName !== optionalPackageName
      ) {
        wrongDecisions.push(
          `${ownedTemplatePath} (${optionalPackageName}) decided ${JSON.stringify(decision)}`,
        )
      }
    }

    expect(wrongDecisions).toEqual([])

    // Every owned path is a legal AppTemplateRelativePath, including the catch-all route's bracketed
    // directory, or @hearthkit/create cannot carry it through the branded schema as it copies.
    expect(
      ownedPathEntries
        .map(({ ownedTemplatePath }) => ownedTemplatePath)
        .filter(
          (ownedTemplatePath) =>
            !appTemplateRelativePathSchema.safeParse(ownedTemplatePath).success,
        ),
    ).toEqual([])
  })

  it('treats an absent selection as the superset and an empty selection as no optional package, which are never the same answer', async () => {
    const decideTemplatePathPrune = await loadDecideTemplatePathPrune()

    // Absent is what verify:container's call site passes and what the template itself is.
    const copiedInTheSuperset = ownedPathEntries.filter(
      ({ ownedTemplatePath }) =>
        decideTemplatePathPrune({ templateRelativePath: ownedTemplatePath }).kind !==
        'template-path-copied',
    )
    expect(copiedInTheSuperset).toEqual([])

    // A partial selection keeps its own package's paths and prunes the rest, which is the question
    // the old boolean could not express at all.
    const selectedOptionalPackageNames: AppTemplateOptionalPackageName[] = ['@hearthkit/storage']
    const partialSelectionMistakes: string[] = []
    for (const { optionalPackageName, ownedTemplatePath } of ownedPathEntries) {
      const decision = decideTemplatePathPrune({
        templateRelativePath: ownedTemplatePath,
        selectedOptionalPackageNames,
      })
      const expectedKind = selectedOptionalPackageNames.includes(optionalPackageName)
        ? 'template-path-copied'
        : 'template-path-optional-package-unselected'
      if (decision.kind !== expectedKind) {
        partialSelectionMistakes.push(
          `${ownedTemplatePath} (${optionalPackageName}) decided ${decision.kind}, expected ${expectedKind}`,
        )
      }
    }
    expect(partialSelectionMistakes).toEqual([])
  })

  it('keeps .git and the verify harness packed-packages directory never-copied without listing either in the contract', async () => {
    const decideTemplatePathPrune = await loadDecideTemplatePathPrune()

    // Neither is part of the template artifact: one is the repo, one is scaffolding the harness
    // writes inside the materialized project, so neither joins appTemplateNeverCopiedDirectoryNames
    // and both stay hardcoded in the materializer.
    for (const harnessPath of ['.git/HEAD', 'hearthkit-packages/hearthkit-config-0.0.0.tgz']) {
      expect(decideTemplatePathPrune({ templateRelativePath: harnessPath }).kind, harnessPath).toBe(
        'template-path-never-copied',
      )
    }
    expect(appTemplateNeverCopiedDirectoryNames as readonly string[]).not.toContain('.git')
    expect(appTemplateNeverCopiedDirectoryNames as readonly string[]).not.toContain(
      'hearthkit-packages',
    )
  })
})
