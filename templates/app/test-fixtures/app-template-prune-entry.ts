import { z } from 'zod'
import {
  expectExportedFunctionOfType,
  importTemplateModule,
} from './app-template-gate-expectations.ts'

/**
 * The two functions Phase 6 consumes, loaded from the materializer.
 *
 * CONTRACT.md names `materialize-app-template-project.ts` as the home of `decideTemplatePathPrune`
 * (it replaces `isPrunedTemplatePath` there) and names no file at all for
 * `pruneOptionalSectionBlocks`. The gates read both from that one module, because it is the only
 * file the contract associates with the pruning mechanism and the only caller either function has
 * today. If the implementor puts the block pruner elsewhere it must still be re-exported by name
 * from here, or these gates cannot reach it.
 *
 * The types below are structural rather than imported: this directory never imports src/, so
 * DecideTemplatePathPrune and PruneOptionalSectionBlocks stay in the contract and the gates parse
 * every returned decision through appTemplatePruneDecisionSchema rather than trusting this shape.
 */

/** What decideTemplatePathPrune answers, as a gate reads it before parsing it through the contract schema. */
export type GatePruneDecision = {
  kind: string
  owningOptionalPackageName?: string
}

/** The pruning half of the materializer: one path decision and one file rewrite, both pure. */
export type AppTemplatePruneEntry = {
  decideTemplatePathPrune: (options: {
    templateRelativePath: string
    selectedOptionalPackageNames?: readonly string[]
  }) => GatePruneDecision
  pruneOptionalSectionBlocks: (options: {
    fileText: string
    selectedOptionalPackageNames?: readonly string[]
  }) => string
}

/** Path the gates report when either function is missing, so a pre-implementation run names the file to write. */
const materializerModulePath = 'src/materialize-app-template-project.ts'

/** Loads both pruning functions, failing the calling gate by name when either is absent. */
export async function loadAppTemplatePruneEntry(
  importMaterializer: () => Promise<unknown>,
): Promise<AppTemplatePruneEntry> {
  const namespace = await importTemplateModule(materializerModulePath, importMaterializer)

  return {
    decideTemplatePathPrune: expectExportedFunctionOfType(
      namespace,
      'decideTemplatePathPrune',
      materializerModulePath,
      z.custom<AppTemplatePruneEntry['decideTemplatePathPrune']>(
        (value) => typeof value === 'function',
      ),
    ),
    pruneOptionalSectionBlocks: expectExportedFunctionOfType(
      namespace,
      'pruneOptionalSectionBlocks',
      materializerModulePath,
      z.custom<AppTemplatePruneEntry['pruneOptionalSectionBlocks']>(
        (value) => typeof value === 'function',
      ),
    ),
  }
}
