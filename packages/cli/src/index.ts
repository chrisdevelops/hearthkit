/** Public entry point of @hearthkit/cli: a named re-export of exactly the surface the contract lists, so no internal module is importable by consumers. */

/** Runs one hearthkit command and returns its exit code and structured result; the bin is a wrapper around this. */
export { runHearthkitCli } from './run-hearthkit-cli.ts'

/** Builds the local infra compose file; pure, so the scaffolder can reuse it instead of copying a template. */
export { generateLocalInfraCompose } from './generate-local-infra-compose.ts'

/** Derives the bucket name the generated compose file creates in MinIO; pure and total, so the scaffolder writes the identical string to STORAGE_BUCKET. */
export { deriveLocalStorageBucketName } from './derive-local-storage-bucket-name.ts'

/** Turns a package.json name into the project name compose, container, volume, and bucket names are built from; falls back to hearthkit-app. */
export { deriveHearthkitProjectName } from './derive-hearthkit-project-name.ts'

/** Contract values: the unique literal prefix every failure message starts with. */
export {
  cliAdminUrlInvalidErrorPrefix,
  cliComposeFileUnwritableErrorPrefix,
  cliDatabaseUrlInvalidErrorPrefix,
  cliDatabaseUrlMissingErrorPrefix,
  cliDockerUnavailableErrorPrefix,
  cliDoctorFailedErrorPrefix,
  cliInfraComposeFailedErrorPrefix,
  cliNextDevUnavailableErrorPrefix,
  cliProjectManifestMissingErrorPrefix,
  cliUsageErrorPrefix,
} from './cli-contract.ts'

/** Contract values: the unique literal prefix of each command's single stdout line and of the db create warning. */
export {
  cliDbBackupCompleteLinePrefix,
  cliDbCreateCredentialsWarningPrefix,
  cliDbDropCompleteLinePrefix,
  cliDbMigrateCompleteLinePrefix,
  cliDbRestoreCompleteLinePrefix,
  cliDevInfraDownCompleteLinePrefix,
  cliDevInfraUpCompleteLinePrefix,
} from './cli-contract.ts'

/** Contract values: this package's env fragment and the defaults its resolution rules fall back to. */
export {
  adminDatabaseUrlEnvVariableName,
  cliEnvSchemaFragment,
  defaultBackupDirectoryPath,
  defaultLocalAdminDatabaseUrl,
  defaultMigrationsFolderPath,
} from './cli-contract.ts'

/** Contract values: the local infra vocabulary, including the single place each service image is pinned. */
export {
  generateLocalInfraComposeOptionsSchema,
  hearthkitProjectNameSchema,
  localInfraServiceByHearthkitPackage,
  localInfraServiceImageByName,
  localInfraServiceNameSchema,
} from './cli-contract.ts'

/** Contract values: the bucket init container's service key and image pin, and the name schema the derived bucket name satisfies. */
export {
  localStorageBucketInitImage,
  localStorageBucketInitServiceName,
  localStorageBucketNameSchema,
} from './cli-contract.ts'

/** Contract values: the command registry, result, failure, and doctor schemas gates and consumers parse with. */
export {
  cliCommandInvocationSchema,
  cliCommandPathSchema,
  cliCommandResultSchema,
  cliCommandSuccessSchema,
  cliExitCodeSchema,
  cliFailureSchema,
  cliRunOutcomeSchema,
  doctorCheckNameSchema,
  doctorCheckResultSchema,
  doctorJsonReportSchema,
  runHearthkitCliOptionsSchema,
} from './cli-contract.ts'

/** Contract types: the vocabulary a consumer needs to hold a run's outcome without re-deriving it. */
export type {
  CliCommandInvocation,
  CliCommandPath,
  CliCommandResult,
  CliCommandSuccess,
  CliExitCode,
  CliFailure,
  CliRunOutcome,
  DeriveLocalStorageBucketName,
  DoctorCheckName,
  DoctorCheckResult,
  DoctorJsonReport,
  GenerateLocalInfraCompose,
  GenerateLocalInfraComposeOptions,
  HearthkitProjectName,
  LocalInfraServiceName,
  LocalStorageBucketName,
  RunHearthkitCli,
  RunHearthkitCliOptions,
} from './cli-contract.ts'
