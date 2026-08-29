import {
  dbFailureSchema,
  postgresConnectionStringSchema,
  projectDatabaseNameSchema,
} from '@hearthkit/db'
import { z } from 'zod'

/** Unique literal prefix of the error message for an unknown command, unknown flag, or schema-invalid argument; exit code 2. */
export const cliUsageErrorPrefix = 'hearthkit cli usage:'

/** Unique literal prefix of the error message when the resolved admin database URL is not a postgres(ql) URL. */
export const cliAdminUrlInvalidErrorPrefix = 'hearthkit cli admin url invalid:'

/** Unique literal prefix of the error message when db migrate has neither a --database-url flag nor DATABASE_URL set; the message names the literal DATABASE_URL variable after the prefix. */
export const cliDatabaseUrlMissingErrorPrefix = 'hearthkit cli database url missing:'

/** Unique literal prefix of the error message when the provided project database URL is not a postgres(ql) URL. */
export const cliDatabaseUrlInvalidErrorPrefix = 'hearthkit cli database url invalid:'

/** Unique literal prefix of the error message when the docker CLI is missing from PATH or the daemon is not running. */
export const cliDockerUnavailableErrorPrefix = 'hearthkit cli docker unavailable:'

/** Unique literal prefix of the error message when a docker compose invocation exits nonzero. */
export const cliInfraComposeFailedErrorPrefix = 'hearthkit cli infra compose failed:'

/** Unique literal prefix of the error message when compose generation is needed but the working directory has no package.json. */
export const cliProjectManifestMissingErrorPrefix = 'hearthkit cli project manifest missing:'

/** Unique literal prefix of the error message when the generated docker-compose.yml cannot be written. */
export const cliComposeFileUnwritableErrorPrefix = 'hearthkit cli compose file unwritable:'

/** Unique literal prefix of the error message when hearthkit dev finds no runnable next binary in the project. */
export const cliNextDevUnavailableErrorPrefix = 'hearthkit cli next dev unavailable:'

/** Unique literal prefix of the stderr line printed when at least one doctor check did not pass; exit code 1. */
export const cliDoctorFailedErrorPrefix = 'hearthkit doctor failed:'

/** Unique literal prefix of the one-time stderr warning printed by hearthkit db create that the credentials are shown once and never persisted. */
export const cliDbCreateCredentialsWarningPrefix = 'hearthkit db create warning:'

/** Unique literal prefix of the single stdout success line of hearthkit db drop. */
export const cliDbDropCompleteLinePrefix = 'hearthkit db drop complete:'

/** Unique literal prefix of the single stdout success line of hearthkit db migrate. */
export const cliDbMigrateCompleteLinePrefix = 'hearthkit db migrate complete:'

/** Unique literal prefix of the single stdout success line of hearthkit db backup. */
export const cliDbBackupCompleteLinePrefix = 'hearthkit db backup complete:'

/** Unique literal prefix of the single stdout success line of hearthkit db restore. */
export const cliDbRestoreCompleteLinePrefix = 'hearthkit db restore complete:'

/** Unique literal prefix of the single stdout success line of hearthkit dev infra up. */
export const cliDevInfraUpCompleteLinePrefix = 'hearthkit dev infra up complete:'

/** Unique literal prefix of the single stdout success line of hearthkit dev infra down. */
export const cliDevInfraDownCompleteLinePrefix = 'hearthkit dev infra down complete:'

/** Name of the operator env variable holding the admin connection; overridden by --admin-database-url, overrides the local default. */
export const adminDatabaseUrlEnvVariableName = 'HEARTHKIT_ADMIN_DATABASE_URL'

/** Fallback admin connection when neither flag nor env provides one; matches the repo and generated compose Postgres service. */
export const defaultLocalAdminDatabaseUrl = postgresConnectionStringSchema.parse(
  'postgresql://hearthkit:hearthkit@localhost:5432/hearthkit',
)

/** Default drizzle-kit output folder used by hearthkit db migrate when --migrations-folder is not given. */
export const defaultMigrationsFolderPath = './drizzle'

/** Default directory (relative to cwd) where hearthkit db backup writes archives when --backup-file is not given. */
export const defaultBackupDirectoryPath = './backups'

/** Env schema fragment this package owns; operator-time variable read by the CLI itself, never composed into app boot config. */
export const cliEnvSchemaFragment = z.object({
  HEARTHKIT_ADMIN_DATABASE_URL: postgresConnectionStringSchema.optional(),
})

/** Hearthkit project name; lowercase kebab-case used for compose project, container, and volume names, distinct from ProjectDatabaseName. */
export const hearthkitProjectNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/)
  .max(63)
  .brand<'HearthkitProjectName'>()

/** Branded hearthkit project name; derived from package.json name by stripping the scope and sanitizing to kebab-case. */
export type HearthkitProjectName = z.infer<typeof hearthkitProjectNameSchema>

/** The three local infra services from plan section 6; the only values infraServices accepts and the only names startedInfraServices reports. */
export const localInfraServiceNameSchema = z.enum(['postgres', 'minio', 'mailpit'])

/** Local infra service name; postgres for db, minio for storage, mailpit for email. */
export type LocalInfraServiceName = z.infer<typeof localInfraServiceNameSchema>

/** Pinned container image per selectable local infra service; the one place to bump these three (the bucket init container is pinned by localStorageBucketInitImage). */
export const localInfraServiceImageByName = {
  postgres: 'postgres:17',
  minio: 'minio/minio:RELEASE.2025-09-07T16-13-09Z',
  mailpit: 'axllent/mailpit:v1.31',
} as const satisfies Record<LocalInfraServiceName, string>

/** Which hearthkit package pulls in which local infra service when dev infra up derives services from package.json. */
export const localInfraServiceByHearthkitPackage = {
  '@hearthkit/db': 'postgres',
  '@hearthkit/storage': 'minio',
  '@hearthkit/email': 'mailpit',
} as const satisfies Record<string, LocalInfraServiceName>

/** Compose service key of the container that creates the local storage bucket and then stays running on purpose, because docker compose up --wait exits 1 when a service it started has exited; deliberately not a LocalInfraServiceName because no project selects it. */
export const localStorageBucketInitServiceName = 'minio-init'

/** Pinned image of the bucket init container; the one place to bump it, kept out of localInfraServiceImageByName because that map is keyed by selectable services. */
export const localStorageBucketInitImage = 'minio/mc:RELEASE.2025-08-13T08-35-41Z'

/** Local development bucket name; the S3 and R2 intersection, so the same string is valid against either and against MinIO. */
export const localStorageBucketNameSchema = z
  .string()
  .min(3)
  .max(63)
  .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/)
  .brand<'LocalStorageBucketName'>()

/** Branded local storage bucket name; what dev infra up creates in MinIO and what STORAGE_BUCKET holds during local development. */
export type LocalStorageBucketName = z.infer<typeof localStorageBucketNameSchema>

/** Signature of deriveLocalStorageBucketName: pure and total, truncating the project name so every valid project name yields a valid bucket name. */
export type DeriveLocalStorageBucketName = (
  hearthkitProjectName: HearthkitProjectName,
) => LocalStorageBucketName

/** Options for generateLocalInfraCompose; infraServices must name at least one service, duplicates are a caller bug, and the bucket name is derived from hearthkitProjectName rather than passed in. */
export const generateLocalInfraComposeOptionsSchema = z.object({
  hearthkitProjectName: hearthkitProjectNameSchema,
  infraServices: z.array(localInfraServiceNameSchema).min(1),
})

/** Options type for generateLocalInfraCompose. */
export type GenerateLocalInfraComposeOptions = z.infer<
  typeof generateLocalInfraComposeOptionsSchema
>

/** Signature of generateLocalInfraCompose: pure and deterministic, returns compose YAML using the localInfraServiceImageByName and localStorageBucketInitImage pins. */
export type GenerateLocalInfraCompose = (options: GenerateLocalInfraComposeOptions) => string

/** Every command path the Phase 2 CLI dispatches; later phases append payments sync, infra apply, vps bootstrap additively. */
export const cliCommandPathSchema = z.enum([
  'db create',
  'db drop',
  'db migrate',
  'db backup',
  'db restore',
  'dev',
  'dev infra up',
  'dev infra down',
  'doctor',
])

/** Command path union; unknown paths are a cli-usage-invalid failure, never a silent no-op. */
export type CliCommandPath = z.infer<typeof cliCommandPathSchema>

/** A parsed invocation after flag and env resolution; admin and database URLs are already resolved per the contract's precedence. */
export const cliCommandInvocationSchema = z.discriminatedUnion('commandPath', [
  z.object({
    commandPath: z.literal('db create'),
    projectDatabaseName: projectDatabaseNameSchema,
    adminDatabaseUrl: postgresConnectionStringSchema,
  }),
  z.object({
    commandPath: z.literal('db drop'),
    projectDatabaseName: projectDatabaseNameSchema,
    adminDatabaseUrl: postgresConnectionStringSchema,
  }),
  z.object({
    commandPath: z.literal('db migrate'),
    databaseUrl: postgresConnectionStringSchema,
    migrationsFolderPath: z.string().min(1),
  }),
  z.object({
    commandPath: z.literal('db backup'),
    projectDatabaseName: projectDatabaseNameSchema,
    adminDatabaseUrl: postgresConnectionStringSchema,
    backupFilePath: z.string().min(1),
  }),
  z.object({
    commandPath: z.literal('db restore'),
    projectDatabaseName: projectDatabaseNameSchema,
    adminDatabaseUrl: postgresConnectionStringSchema,
    backupFilePath: z.string().min(1),
  }),
  z.object({ commandPath: z.literal('dev') }),
  z.object({ commandPath: z.literal('dev infra up') }),
  z.object({ commandPath: z.literal('dev infra down') }),
  z.object({ commandPath: z.literal('doctor'), jsonOutput: z.boolean() }),
])

/** Parsed invocation union; the shape command handlers receive after resolution succeeds. */
export type CliCommandInvocation = z.infer<typeof cliCommandInvocationSchema>

/** The eight doctor check names; a check may be skipped only when its prerequisite check failed. */
export const doctorCheckNameSchema = z.enum([
  'node-version-supported',
  'pnpm-command-available',
  'docker-cli-available',
  'docker-daemon-running',
  'docker-compose-plugin-available',
  'postgres-client-tools-version',
  'admin-database-reachable',
  'cli-env-variables-valid',
])

/** Doctor check name union; stable identifiers gates and --json consumers key on. */
export type DoctorCheckName = z.infer<typeof doctorCheckNameSchema>

/** One doctor check outcome; detail is a single human-readable line (found version, error summary, or skip reason). */
export const doctorCheckResultSchema = z.object({
  checkName: doctorCheckNameSchema,
  status: z.enum(['pass', 'fail', 'skip']),
  detail: z.string(),
})

/** Doctor check result; skip counts as not-passed for the exit code. */
export type DoctorCheckResult = z.infer<typeof doctorCheckResultSchema>

/** Exact object doctor --json prints as JSON on stdout, on success and on doctor-checks-failed alike (then allDoctorChecksPassed is false). */
export const doctorJsonReportSchema = z.object({
  checks: z.array(doctorCheckResultSchema).min(1),
  allDoctorChecksPassed: z.boolean(),
})

/** Doctor --json stdout envelope type; the only machine-readable doctor output shape. */
export type DoctorJsonReport = z.infer<typeof doctorJsonReportSchema>

/** Every way a CLI command can fail; each variant's message starts with its unique prefix and is the last stderr line. */
export const cliFailureSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('cli-usage-invalid'),
    message: z.string().startsWith(cliUsageErrorPrefix),
  }),
  z.object({
    kind: z.literal('admin-database-url-invalid'),
    message: z.string().startsWith(cliAdminUrlInvalidErrorPrefix),
  }),
  z.object({
    kind: z.literal('database-url-missing'),
    message: z.string().startsWith(cliDatabaseUrlMissingErrorPrefix),
  }),
  z.object({
    kind: z.literal('database-url-invalid'),
    message: z.string().startsWith(cliDatabaseUrlInvalidErrorPrefix),
  }),
  z.object({
    kind: z.literal('db-command-failed'),
    dbFailure: dbFailureSchema,
    message: z.string().startsWith('hearthkit db '),
  }),
  z.object({
    kind: z.literal('docker-unavailable'),
    message: z.string().startsWith(cliDockerUnavailableErrorPrefix),
  }),
  z.object({
    kind: z.literal('infra-compose-failed'),
    composeExitCode: z.number().int(),
    composeStderrExcerpt: z.string(),
    message: z.string().startsWith(cliInfraComposeFailedErrorPrefix),
  }),
  z.object({
    kind: z.literal('project-manifest-missing'),
    manifestPath: z.string().min(1),
    message: z.string().startsWith(cliProjectManifestMissingErrorPrefix),
  }),
  z.object({
    kind: z.literal('compose-file-unwritable'),
    composeFilePath: z.string().min(1),
    message: z.string().startsWith(cliComposeFileUnwritableErrorPrefix),
  }),
  z.object({
    kind: z.literal('next-dev-unavailable'),
    message: z.string().startsWith(cliNextDevUnavailableErrorPrefix),
  }),
  z.object({
    kind: z.literal('doctor-checks-failed'),
    checks: z.array(doctorCheckResultSchema).min(1),
    failedCheckNames: z.array(doctorCheckNameSchema).min(1),
    message: z.string().startsWith(cliDoctorFailedErrorPrefix),
  }),
])

/** Discriminated failure union; db-command-failed wraps the DbFailure verbatim and its message is the db message unchanged. */
export type CliFailure = z.infer<typeof cliFailureSchema>

/** Success shapes per command; each mirrors what the single stdout line reports so gates can check either channel. */
export const cliCommandSuccessSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('db-create-command-succeeded'),
    projectDatabaseName: projectDatabaseNameSchema,
    connectionString: postgresConnectionStringSchema,
  }),
  z.object({
    kind: z.literal('db-drop-command-succeeded'),
    projectDatabaseName: projectDatabaseNameSchema,
  }),
  z.object({
    kind: z.literal('db-migrate-command-succeeded'),
    appliedMigrationCount: z.number().int().min(0),
  }),
  z.object({
    kind: z.literal('db-backup-command-succeeded'),
    projectDatabaseName: projectDatabaseNameSchema,
    backupFilePath: z.string().min(1),
    backupByteCount: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal('db-restore-command-succeeded'),
    projectDatabaseName: projectDatabaseNameSchema,
    backupFilePath: z.string().min(1),
  }),
  z.object({
    kind: z.literal('dev-infra-up-succeeded'),
    startedInfraServices: z.array(localInfraServiceNameSchema),
  }),
  z.object({ kind: z.literal('dev-infra-down-succeeded') }),
  z.object({
    kind: z.literal('dev-command-exited'),
    nextDevExitCode: z.number().int().min(0).max(255),
  }),
  z.object({
    kind: z.literal('doctor-report'),
    checks: z.array(doctorCheckResultSchema).min(1),
    allDoctorChecksPassed: z.literal(true),
  }),
])

/** Command success union; doctor-report appears here only when every check passed, otherwise doctor-checks-failed is returned. */
export type CliCommandSuccess = z.infer<typeof cliCommandSuccessSchema>

/** Full result union of one CLI command run, for runtime validation in gates. */
export const cliCommandResultSchema = z.union([cliCommandSuccessSchema, cliFailureSchema])

/** Result type of one CLI command run: a success variant or a CliFailure. */
export type CliCommandResult = z.infer<typeof cliCommandResultSchema>

/** Process exit code of the bin: 0 success, 1 operational failure, 2 usage; hearthkit dev propagates next dev's code. */
export const cliExitCodeSchema = z.number().int().min(0).max(255)

/** Exit code type returned by runHearthkitCli and used by the bin wrapper. */
export type CliExitCode = z.infer<typeof cliExitCodeSchema>

/** Runtime shape of runHearthkitCli options; argv is command words and flags only, without the node and bin prefix. */
export const runHearthkitCliOptionsSchema = z.object({
  argv: z.array(z.string()),
  cwd: z.string().min(1).optional(),
  env: z.record(z.string(), z.string().optional()).optional(),
})

/** Options type for runHearthkitCli; cwd defaults to process.cwd() and env to process.env. */
export type RunHearthkitCliOptions = z.infer<typeof runHearthkitCliOptionsSchema>

/** What one CLI run produced; exitCode is what the bin exits with and result is the structured outcome gates validate. */
export const cliRunOutcomeSchema = z.object({
  exitCode: cliExitCodeSchema,
  result: cliCommandResultSchema,
})

/** Outcome type of runHearthkitCli. */
export type CliRunOutcome = z.infer<typeof cliRunOutcomeSchema>

/** Signature of runHearthkitCli: parses argv, runs the command, writes stdout/stderr, never throws for a contract failure mode. */
export type RunHearthkitCli = (options: RunHearthkitCliOptions) => Promise<CliRunOutcome>
