import {
  cliFailureSchema,
  hearthkitProjectNameSchema,
  localInfraServiceNameSchema,
} from '@hearthkit/cli'
import { postgresConnectionStringSchema, projectDatabaseNameSchema } from '@hearthkit/db'
import { z } from 'zod'

/** The project name is HearthkitProjectName from @hearthkit/cli, re-exported by name so create declares no near-synonym. */
export { hearthkitProjectNameSchema } from '@hearthkit/cli'

/** Branded project name type; kebab-case, lowercase, starts with a letter, at most 63 characters. */
export type { HearthkitProjectName } from '@hearthkit/cli'

/** Unique literal prefix when a required option (projectName or packages) is absent and prompting is off. */
export const createOptionMissingErrorPrefix = 'hearthkit create option missing:'

/** Unique literal prefix when the given project name does not satisfy hearthkitProjectNameSchema. */
export const createProjectNameInvalidErrorPrefix = 'hearthkit create project name invalid:'

/** Unique literal prefix when packages names something outside storage, email, auth, payments. */
export const createPackageUnknownErrorPrefix = 'hearthkit create package unknown:'

/** Unique literal prefix when organizations is true and auth is not in the resolved package set. */
export const createOrganizationsWithoutAuthErrorPrefix =
  'hearthkit create organizations without auth:'

/** Unique literal prefix when the target directory exists and holds at least one entry. */
export const createTargetNotEmptyErrorPrefix = 'hearthkit create target not empty:'

/** Unique literal prefix when pnpm install exits nonzero inside the written project. */
export const createInstallFailedErrorPrefix = 'hearthkit create install failed:'

/** Unique literal prefix when hearthkit dev infra up or hearthkit db create returns a CliFailure. */
export const createInfraUpFailedErrorPrefix = 'hearthkit create infra up failed:'

/** Env schema fragment this package owns; empty, because create reads no environment variable of its own (db create reads HEARTHKIT_ADMIN_DATABASE_URL through @hearthkit/cli). */
export const createEnvSchemaFragment = z.object({})

/** The four packages a user may select, by bare name; db is never selectable because auth and payments pull it in. */
export const createOptionalPackageNameSchema = z.enum(['storage', 'email', 'auth', 'payments'])

/** One selectable package name, for example 'auth'. */
export type CreateOptionalPackageName = z.infer<typeof createOptionalPackageNameSchema>

/** Every package that can end up in a generated project after dependency resolution, in the fixed order resolvedPackages is reported in. */
export const resolvedHearthkitPackageNameSchema = z.enum([
  'db',
  'storage',
  'email',
  'auth',
  'payments',
])

/** One resolved package name; db appears only through auth or payments. */
export type ResolvedHearthkitPackageName = z.infer<typeof resolvedHearthkitPackageNameSchema>

/** The two options that are required and therefore promptable; any other option has a default. */
export const createRequiredOptionNameSchema = z.enum(['projectName', 'packages'])

/** Name of a required option, reported by create-option-missing. */
export type CreateRequiredOptionName = z.infer<typeof createRequiredOptionNameSchema>

/** Raw options of createHearthkitProject as the bin parses them; projectName and packages are unvalidated strings so every rejection is a CreateFailure rather than a thrown Zod error, and absent means prompt-or-fail. */
export const hearthkitCreateOptionsSchema = z.object({
  projectName: z.string().optional(),
  packages: z.array(z.string()).optional(),
  organizations: z.boolean().default(false),
  targetDirectory: z.string().min(1).optional(),
  install: z.boolean().default(true),
  startInfra: z.boolean().default(true),
  packageVersion: z.string().min(1).optional(),
  interactive: z.boolean().optional(),
  templateDirectoryPath: z.string().min(1).optional(),
})

/** Options type of createHearthkitProject; defaults are applied by the function, so a caller may omit every defaulted field. */
export type HearthkitCreateOptions = z.input<typeof hearthkitCreateOptionsSchema>

/** One command create ran to completion, in the order it ran; a failed command never appears here because the run returns a CreateFailure instead. */
export const createCommandRecordSchema = z.discriminatedUnion('commandName', [
  z.object({ commandName: z.literal('pnpm install') }),
  z.object({
    commandName: z.literal('hearthkit dev infra up'),
    startedInfraServices: z.array(localInfraServiceNameSchema),
  }),
  z.object({
    commandName: z.literal('hearthkit db create'),
    projectDatabaseName: projectDatabaseNameSchema,
    connectionString: postgresConnectionStringSchema,
  }),
])

/** Record of one completed command; hearthkit db create carries the one-time connection string that is never written to disk. */
export type CreateCommandRecord = z.infer<typeof createCommandRecordSchema>

/** Success shape of createHearthkitProject: the written tree summary and the commands that ran. */
export const hearthkitProjectCreatedSchema = z.object({
  kind: z.literal('hearthkit-project-created'),
  projectName: hearthkitProjectNameSchema,
  projectDirectoryPath: z.string().min(1),
  resolvedPackages: z.array(resolvedHearthkitPackageNameSchema),
  organizationsEnabled: z.boolean(),
  writtenPaths: z.array(z.string().min(1)).min(1),
  commandsRun: z.array(createCommandRecordSchema),
  nextSteps: z.array(z.string().min(1)).min(1),
})

/** Success type; projectDirectoryPath is absolute, writtenPaths are relative POSIX paths sorted ascending, resolvedPackages follow resolvedHearthkitPackageNameSchema order. */
export type HearthkitProjectCreated = z.infer<typeof hearthkitProjectCreatedSchema>

/** Every way createHearthkitProject can fail; each message starts with its unique literal prefix and is the last stderr line before exit 1 (exit 2 for the first four). */
export const createFailureSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('create-option-missing'),
    optionName: createRequiredOptionNameSchema,
    message: z.string().startsWith(createOptionMissingErrorPrefix),
  }),
  z.object({
    kind: z.literal('create-project-name-invalid'),
    projectName: z.string(),
    message: z.string().startsWith(createProjectNameInvalidErrorPrefix),
  }),
  z.object({
    kind: z.literal('create-package-unknown'),
    unknownPackageNames: z.array(z.string()).min(1),
    message: z.string().startsWith(createPackageUnknownErrorPrefix),
  }),
  z.object({
    kind: z.literal('create-organizations-without-auth'),
    resolvedPackages: z.array(resolvedHearthkitPackageNameSchema),
    message: z.string().startsWith(createOrganizationsWithoutAuthErrorPrefix),
  }),
  z.object({
    kind: z.literal('create-target-not-empty'),
    targetDirectoryPath: z.string().min(1),
    message: z.string().startsWith(createTargetNotEmptyErrorPrefix),
  }),
  z.object({
    kind: z.literal('create-install-failed'),
    installExitCode: z.number().int(),
    installOutputExcerpt: z.string().min(1),
    message: z.string().startsWith(createInstallFailedErrorPrefix),
  }),
  z.object({
    kind: z.literal('create-infra-up-failed'),
    failedCommand: z.enum(['hearthkit dev infra up', 'hearthkit db create']),
    cliFailure: cliFailureSchema,
    message: z.string().startsWith(createInfraUpFailedErrorPrefix),
  }),
])

/** Discriminated failure union of create; create-infra-up-failed wraps the CliFailure verbatim, its message is the cli message unchanged after the create prefix. */
export type CreateFailure = z.infer<typeof createFailureSchema>

/** Full result union of one scaffold run, for runtime validation in gates. */
export const createHearthkitProjectResultSchema = z.union([
  hearthkitProjectCreatedSchema,
  createFailureSchema,
])

/** Result type of createHearthkitProject: the success shape or a CreateFailure. */
export type CreateHearthkitProjectResult = z.infer<typeof createHearthkitProjectResultSchema>

/** Signature of createHearthkitProject: validates, resolves, writes the tree, runs the commands, prints next steps; never throws for a contract failure mode and never deletes a directory. */
export type CreateHearthkitProject = (
  options: HearthkitCreateOptions,
) => Promise<CreateHearthkitProjectResult>
