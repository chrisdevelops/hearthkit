import { describe, expect, it } from 'vitest'
import { loadHearthkitCreateEntry } from '../test-fixtures/create-gate-project-directories.ts'
import {
  appTemplateNeverCopiedDirectoryNames,
  appTemplatePruneDecisionSchema,
  appTemplateRelativePathSchema,
  appTemplateRepoOnlyDirectoryNames,
  appTemplateRepoOnlyPaths,
  appTemplateVerifyContainerScriptPath,
  ownedTemplatePathEntries,
  type AppTemplateOptionalPackageName,
  type AppTemplatePruneDecision,
} from '../test-fixtures/create-gate-template-manifest.ts'

/**
 * The path half of pruning, moved here with the logic it covers (completion plan 3.2). The decision
 * is a discriminated union rather than a boolean because the second question a boolean has no room
 * for is WHICH package caused a deletion. Every decision goes through
 * `appTemplatePruneDecisionSchema`, so a bare boolean or a plain string fails here rather than
 * downstream in the copy walk.
 */

/** Calls the function through the package entry point and parses whatever it answered. */
async function loadDecideTemplatePathPrune(): Promise<
  (options: {
    templateRelativePath: string
    selectedOptionalPackageNames?: readonly AppTemplateOptionalPackageName[]
  }) => AppTemplatePruneDecision
> {
  const { decideTemplatePathPrune } = await loadHearthkitCreateEntry()
  return (options) => appTemplatePruneDecisionSchema.parse(decideTemplatePathPrune(options))
}

describe('decideTemplatePathPrune', () => {
  it('answers copied, never-copied and repo-only for the paths no selection has anything to do with', async () => {
    const decideTemplatePathPrune = await loadDecideTemplatePathPrune()

    // Only template-path-copied reaches a generated project, and the answer is the same whether a
    // selection was given or not.
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
        decideTemplatePathPrune({ templateRelativePath: `${neverCopiedDirectoryName}/anything.js` })
          .kind,
        neverCopiedDirectoryName,
      ).toBe('template-path-never-copied')
    }

    // Neither of these is part of the template artifact: one is the repo, one is scaffolding the
    // verify harness writes inside the project, so neither is listed in the contract and both stay
    // hardcoded in the pruner.
    for (const harnessPath of ['.git/HEAD', 'hearthkit-packages/hearthkit-config-0.0.0.tgz']) {
      expect(decideTemplatePathPrune({ templateRelativePath: harnessPath }).kind, harnessPath).toBe(
        'template-path-never-copied',
      )
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

  it('names the owning package for every unselected path, and treats an absent selection as the superset', async () => {
    const decideTemplatePathPrune = await loadDecideTemplatePathPrune()
    const wrongDecisions: string[] = []

    for (const { optionalPackageName, ownedTemplatePath } of ownedTemplatePathEntries) {
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

    // Absent is not empty. Absent is the superset, which is what verify:container's call site and
    // the template itself are; empty is a user who chose nothing.
    expect(
      ownedTemplatePathEntries.filter(
        ({ ownedTemplatePath }) =>
          decideTemplatePathPrune({ templateRelativePath: ownedTemplatePath }).kind !==
          'template-path-copied',
      ),
    ).toEqual([])

    // A partial selection keeps its own package's paths and prunes the rest, which is the question
    // the old boolean could not express at all.
    const selectedOptionalPackageNames: AppTemplateOptionalPackageName[] = ['@hearthkit/storage']
    const partialSelectionMistakes: string[] = []
    for (const { optionalPackageName, ownedTemplatePath } of ownedTemplatePathEntries) {
      const expectedKind = selectedOptionalPackageNames.includes(optionalPackageName)
        ? 'template-path-copied'
        : 'template-path-optional-package-unselected'
      const decision = decideTemplatePathPrune({
        templateRelativePath: ownedTemplatePath,
        selectedOptionalPackageNames,
      })
      if (decision.kind !== expectedKind) {
        partialSelectionMistakes.push(
          `${ownedTemplatePath} (${optionalPackageName}) decided ${decision.kind}, expected ${expectedKind}`,
        )
      }
    }
    expect(partialSelectionMistakes).toEqual([])

    // Every owned path is a legal AppTemplateRelativePath, bracketed catch-all route included, or
    // create cannot carry it through the branded schema as it copies.
    expect(
      ownedTemplatePathEntries
        .map(({ ownedTemplatePath }) => ownedTemplatePath)
        .filter(
          (ownedTemplatePath) =>
            !appTemplateRelativePathSchema.safeParse(ownedTemplatePath).success,
        ),
    ).toEqual([])
  })
})
