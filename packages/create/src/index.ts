/** Public entry point of @hearthkit/create: a named re-export of exactly the surface the contract lists, so no internal module is importable by consumers. */

/** Scaffolds one project from the app template; never throws for a listed failure mode and never deletes a directory. */
export { createHearthkitProject } from './create-hearthkit-project.ts'

/** Decides what happens to one template path under a selection; pure, total, and it reads nothing from disk. */
export { decideTemplatePathPrune } from './decide-template-path-prune.ts'

/** Prunes one file's marked section blocks for a selection; an absent selection returns the text unchanged. */
export { pruneOptionalSectionBlocks } from './prune-optional-section-blocks.ts'

/** Contract values: the unique literal prefix every failure message starts with. */
export {
  createInfraUpFailedErrorPrefix,
  createInstallFailedErrorPrefix,
  createOptionMissingErrorPrefix,
  createOrganizationsWithoutAuthErrorPrefix,
  createPackageUnknownErrorPrefix,
  createProjectNameInvalidErrorPrefix,
  createTargetNotEmptyErrorPrefix,
} from './create-contract.ts'

/** Contract values: this package's empty env fragment and the package-name vocabulary a selection is written in. */
export {
  createEnvSchemaFragment,
  createOptionalPackageNameSchema,
  createRequiredOptionNameSchema,
  hearthkitProjectNameSchema,
  resolvedHearthkitPackageNameSchema,
} from './create-contract.ts'

/** Contract values: the option, result and failure schemas gates and consumers parse with. */
export {
  createCommandRecordSchema,
  createFailureSchema,
  createHearthkitProjectResultSchema,
  hearthkitCreateOptionsSchema,
  hearthkitProjectCreatedSchema,
} from './create-contract.ts'

/** Contract types: the vocabulary a consumer needs to hold one scaffold run's options and outcome. */
export type {
  CreateCommandRecord,
  CreateFailure,
  CreateHearthkitProject,
  CreateHearthkitProjectResult,
  CreateOptionalPackageName,
  CreateRequiredOptionName,
  HearthkitCreateOptions,
  HearthkitProjectCreated,
  HearthkitProjectName,
  ResolvedHearthkitPackageName,
} from './create-contract.ts'
