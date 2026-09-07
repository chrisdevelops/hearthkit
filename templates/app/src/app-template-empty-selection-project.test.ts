import { describe, expect, it } from 'vitest'
import { loadAppTemplatePruneEntry } from '../test-fixtures/app-template-prune-entry.ts'
import {
  documentedEnvVariableNamesIn,
  readTemplateFileText,
  trackedTemplateFilePaths,
} from '../test-fixtures/app-template-tree-files.ts'
import {
  appGeneratedProjectGuaranteedPaths,
  appTemplateEnvVariableNames,
  appTemplateFailureSchema,
  appTemplateOptionalBlockCopiedErrorPrefix,
  appTemplateOptionalPackageNames,
  appTemplateOptionalSectionCopiedErrorPrefix,
  appTemplateRenamedPaths,
  appTemplateSectionBlockBeginPrefix,
  appTemplateSectionBlockEndPrefix,
  appTemplateSectionsByOptionalPackage,
} from './app-template-contract.ts'

/**
 * The empty-selection project: what a user gets when they pick nothing, and the strongest available
 * check that the always-on project is still exactly what it was. verify:container materializes this
 * same selection on every invocation, so anything these gates catch would otherwise surface as a
 * broken Docker build minutes later.
 *
 * The walk is over git's file list rather than the directory, because next-env.d.ts and
 * tsconfig.tsbuildinfo appear in the working tree the moment anyone typechecks here and are named in
 * no contract list. Comparing against the directory would make this gate pass or fail on which
 * command someone ran last.
 */

/** The name a template file is written under in a generated project; only the ignore file changes. */
function generatedProjectPathOf(templateRelativePath: string): string {
  return (
    appTemplateRenamedPaths.find((rename) => rename.templatePath === templateRelativePath)
      ?.generatedProjectPath ?? templateRelativePath
  )
}

/** Every path an empty-selection project keeps, and the text each one carries after its blocks are pruned. */
async function materializeEmptySelectionProject(): Promise<Map<string, string>> {
  const { decideTemplatePathPrune, pruneOptionalSectionBlocks } = await loadAppTemplatePruneEntry(
    () => import('./materialize-app-template-project.ts'),
  )
  const emptySelectionProject = new Map<string, string>()

  for (const templateRelativePath of trackedTemplateFilePaths()) {
    const decision = decideTemplatePathPrune({
      templateRelativePath,
      selectedOptionalPackageNames: [],
    })
    if (decision.kind !== 'template-path-copied') {
      continue
    }
    emptySelectionProject.set(
      generatedProjectPathOf(templateRelativePath),
      pruneOptionalSectionBlocks({
        fileText: readTemplateFileText(templateRelativePath),
        selectedOptionalPackageNames: [],
      }),
    )
  }

  return emptySelectionProject
}

describe('a project materialized with an empty optional-package selection', () => {
  it('reproduces appGeneratedProjectGuaranteedPaths exactly, with no section file left behind', async () => {
    const emptySelectionProject = await materializeEmptySelectionProject()

    expect([...emptySelectionProject.keys()].toSorted()).toEqual([
      ...appGeneratedProjectGuaranteedPaths,
    ])

    // Reported with the contract's own prefix, so a failing run reads like the failure it models.
    const copiedSectionPaths: string[] = []
    for (const optionalPackageName of appTemplateOptionalPackageNames) {
      for (const ownedTemplatePath of appTemplateSectionsByOptionalPackage[optionalPackageName]
        .ownedTemplatePaths) {
        if (emptySelectionProject.has(generatedProjectPathOf(ownedTemplatePath))) {
          copiedSectionPaths.push(
            `${appTemplateOptionalSectionCopiedErrorPrefix} ${ownedTemplatePath} (${optionalPackageName})`,
          )
        }
      }
    }
    expect(copiedSectionPaths).toEqual([])

    const sectionCopiedFailure = appTemplateFailureSchema.parse({
      kind: 'app-template-optional-section-copied',
      copiedPath: 'app/storage/page.tsx',
      owningOptionalPackageName: '@hearthkit/storage',
      message: `${appTemplateOptionalSectionCopiedErrorPrefix} app/storage/page.tsx`,
    })
    expect(sectionCopiedFailure.kind).toBe('app-template-optional-section-copied')
  })

  it('leaves no occurrence of either marker prefix in any file it keeps', async () => {
    const emptySelectionProject = await materializeEmptySelectionProject()
    const survivingMarkers: string[] = []

    // A surviving marker means the pruner skipped a file it should have processed, and the project
    // still runs — so nothing else catches it. The scan is over every kept file, not only over the
    // declared blockPrunedPaths, because "the pruner never saw this file" is exactly the mistake a
    // scan of the declared list cannot see.
    for (const [generatedProjectPath, fileText] of emptySelectionProject) {
      for (const markerPrefix of [
        appTemplateSectionBlockBeginPrefix,
        appTemplateSectionBlockEndPrefix,
      ]) {
        if (fileText.includes(markerPrefix)) {
          survivingMarkers.push(
            `${appTemplateOptionalBlockCopiedErrorPrefix} ${generatedProjectPath}: ${markerPrefix}`,
          )
        }
      }
      // The block bodies go with the markers: an import of a package the project does not depend on
      // is the failure that breaks the build rather than degrading quietly. The quoted form is the
      // specifier spelling, which is what appears in an import and in transpilePackages; the
      // manifest's own "@hearthkit/…" keys are a JSON field edit this walk deliberately leaves to
      // the optional-package-dependency rewrite.
      for (const optionalPackageName of appTemplateOptionalPackageNames) {
        for (const hearthkitDependencyName of appTemplateSectionsByOptionalPackage[
          optionalPackageName
        ].hearthkitDependencyNames) {
          if (fileText.includes(`'${hearthkitDependencyName}'`)) {
            survivingMarkers.push(
              `${appTemplateOptionalBlockCopiedErrorPrefix} ${generatedProjectPath} still imports ${hearthkitDependencyName} (${optionalPackageName})`,
            )
          }
        }
      }
    }

    expect(survivingMarkers).toEqual([])

    const blockCopiedFailure = appTemplateFailureSchema.parse({
      kind: 'app-template-optional-block-copied',
      blockPrunedPath: 'app-runtime-config.ts',
      owningOptionalPackageName: '@hearthkit/storage',
      message: `${appTemplateOptionalBlockCopiedErrorPrefix} app-runtime-config.ts`,
    })
    expect(blockCopiedFailure.kind).toBe('app-template-optional-block-copied')
  })

  it('documents exactly the always-on variables in its .env.example, which is why it boots on an empty environment', async () => {
    const emptySelectionProject = await materializeEmptySelectionProject()
    const emptySelectionEnvExample = emptySelectionProject.get('.env.example')

    if (emptySelectionEnvExample === undefined) {
      throw new Error(
        'gate expected an empty-selection project to keep .env.example, which every generated project gets',
      )
    }

    // The .env.example block rule has never been executed, and the trailing-blank clause is reasoned
    // rather than measured. This is the gate that settles it: whatever the four blocks look like,
    // removing all four has to leave the three always-on variables and nothing else.
    expect(documentedEnvVariableNamesIn(emptySelectionEnvExample).toSorted()).toEqual(
      [...appTemplateEnvVariableNames].toSorted(),
    )

    // The header sits outside every block and is never pruned, so it may only state what is true in
    // every selection: naming a package's variable there would document a variable that is gone.
    for (const optionalPackageName of appTemplateOptionalPackageNames) {
      for (const envVariableName of appTemplateSectionsByOptionalPackage[optionalPackageName]
        .envVariableNames) {
        expect(
          emptySelectionEnvExample,
          `${envVariableName} (${optionalPackageName})`,
        ).not.toContain(envVariableName)
      }
    }
  })
})
