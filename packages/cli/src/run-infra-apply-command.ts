import { stat, writeFile } from 'node:fs/promises'
import { readFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import {
  cloudflareApiTokenEnvVariableName,
  defaultInfraTfvarsPath,
  envProductionExamplePath,
  infraApplyPrintedEnvVariableNames,
  infraApplyRewrittenEnvVariableNames,
  type CliCommandResult,
  type TofuSubcommand,
} from './cli-contract.ts'
import {
  infraEnvMissingFailure,
  infraEnvProductionExampleMissingFailure,
  infraProviderUnsupportedFailure,
  infraTfvarsIncompleteFailure,
  infraTofuFailedFailure,
} from './cli-failure-results.ts'
import type { CliRuntimeContext } from './cli-runtime-context.ts'
import { buildTofuBackendConfigFlags } from './build-tofu-backend-config-flags.ts'
import {
  readInfraApplySecrets,
  readInfraProviderSelection,
  type InfraApplySecretValues,
} from './read-infra-apply-environment.ts'
import { readTofuInputVariablesFile } from './read-tofu-input-variables-file.ts'
import { redactInfraApplySecrets } from './redact-infra-apply-secrets.ts'
import { rewriteEnvProductionExampleText } from './rewrite-env-production-example-text.ts'
import { runChildProcessCommand } from './run-child-process-command.ts'
import { readTofuOutputValues, type CloudflareModuleOutputs } from './read-tofu-output-values.ts'

/**
 * hearthkit infra apply: check the inputs, run the provider module, write the outputs into one
 * example file.
 *
 * Every check happens before the first tofu process exists, in the order the contract lists, so an
 * operator with a half-filled tfvars file learns that from this CLI rather than from a partially
 * applied plan. Secrets travel in child environments only: the CLI holds them in local values, never
 * writes one to a file, and redacts all four from anything tofu says before quoting it.
 */

/** Where the shipped provider module lives, resolved from this file so the published tarball answers the same. */
const cloudflareTofuModuleDirectoryPath = resolve(import.meta.dirname, '..', 'tofu', 'cloudflare')

/** Where tofu keeps its provider cache and lock file: inside the project, never inside node_modules. */
const projectTofuDataDirectoryPath = 'infra/.terraform'

/** The region every R2 S3 client signs for; a constant rather than a module output, because it never varies. */
const storageRegionValue = 'auto'

/** How much of tofu's own output travels back in a failure detail; enough to name a cause, short enough to print. */
const tofuFailureDetailLimit = 4000

/** Runs one infra apply invocation and returns the success shape or the first check that refused it. */
export async function runInfraApplyCommand(context: CliRuntimeContext): Promise<CliCommandResult> {
  const providerSelection = readInfraProviderSelection(context.environmentVariables)
  if (providerSelection.kind === 'infra-provider-unsupported') {
    return infraProviderUnsupportedFailure(providerSelection.providerValue)
  }

  const secretsRead = readInfraApplySecrets(context.environmentVariables)
  if (secretsRead.kind === 'infra-apply-secrets-missing') {
    return infraEnvMissingFailure({
      missingVariableNames: secretsRead.missingVariableNames,
      detail: secretsRead.detail,
    })
  }

  const tfvarsPath = absoluteProjectPath(context, defaultInfraTfvarsPath)
  const tfvarsRead = await readTofuInputVariablesFile(tfvarsPath)
  if (tfvarsRead.kind === 'tofu-input-variables-incomplete') {
    return infraTfvarsIncompleteFailure({
      tfvarsPath,
      incompleteVariableNames: tfvarsRead.incompleteVariableNames,
    })
  }

  const exampleFilePath = absoluteProjectPath(context, envProductionExamplePath)
  const exampleFileExists = await stat(exampleFilePath)
    .then((entry) => entry.isFile())
    .catch(() => false)
  if (!exampleFileExists) {
    return infraEnvProductionExampleMissingFailure(exampleFilePath)
  }

  const tofuRun = await runCloudflareTofuModule({
    context,
    secrets: secretsRead.secrets,
    tfvarsPath,
    projectName: tfvarsRead.variableValues.project_name,
    accountId: tfvarsRead.variableValues.account_id,
  })
  if (tofuRun.kind === 'tofu-run-failed') {
    return infraTofuFailedFailure({
      tofuSubcommand: tofuRun.tofuSubcommand,
      detail: tofuRun.detail,
    })
  }

  const { moduleOutputs } = tofuRun
  const storageValuesByVariableName = {
    STORAGE_ENDPOINT: moduleOutputs.storage_endpoint,
    STORAGE_BUCKET: moduleOutputs.storage_bucket,
    STORAGE_ACCESS_KEY_ID: moduleOutputs.storage_access_key_id,
    STORAGE_SECRET_ACCESS_KEY: moduleOutputs.storage_secret_access_key,
    STORAGE_REGION: storageRegionValue,
  } as const satisfies Record<(typeof infraApplyPrintedEnvVariableNames)[number], string>

  const exampleFileText = await readFile(exampleFilePath, 'utf8')
  await writeFile(
    exampleFilePath,
    rewriteEnvProductionExampleText({
      fileText: exampleFileText,
      // The secret is deliberately not among these: STORAGE_SECRET_ACCESS_KEY= stays blank in the
      // file and is printed once instead.
      assignments: infraApplyRewrittenEnvVariableNames.map((variableName) => ({
        variableName,
        value: storageValuesByVariableName[variableName],
      })),
      dsnHint: moduleOutputs.dsn_hint,
    }),
    'utf8',
  )

  return {
    kind: 'infra-apply-command-succeeded',
    hostname: moduleOutputs.hostname,
    envProductionExamplePath: exampleFilePath,
    storageEnvLines: infraApplyPrintedEnvVariableNames.map(
      (variableName) => `${variableName}=${storageValuesByVariableName[variableName]}`,
    ),
  }
}

/** A project-relative contract path as an absolute one, so every reported path is absolute whatever cwd was. */
function absoluteProjectPath(context: CliRuntimeContext, projectRelativePath: string): string {
  return isAbsolute(projectRelativePath)
    ? projectRelativePath
    : resolve(context.workingDirectoryPath, projectRelativePath)
}

/** What the three tofu runs produced: every module output, or the subcommand that failed and its redacted words. */
type CloudflareTofuModuleRun =
  | { kind: 'tofu-run-succeeded'; moduleOutputs: CloudflareModuleOutputs }
  | { kind: 'tofu-run-failed'; tofuSubcommand: TofuSubcommand; detail: string }

/** Runs tofu init, apply and output against the shipped module and reads the outputs back as strings. */
async function runCloudflareTofuModule(options: {
  context: CliRuntimeContext
  secrets: InfraApplySecretValues
  tfvarsPath: string
  projectName: string
  accountId: string
}): Promise<CloudflareTofuModuleRun> {
  const initRun = await runTofuSubcommand({
    ...options,
    tofuSubcommand: 'init',
    subcommandArguments: [
      'init',
      '-input=false',
      '-no-color',
      ...buildTofuBackendConfigFlags({
        projectName: options.projectName,
        accountId: options.accountId,
      }),
    ],
    withCloudflareApiToken: false,
  })
  if (initRun.kind === 'tofu-subcommand-failed') {
    return initRun.failure
  }

  const applyRun = await runTofuSubcommand({
    ...options,
    tofuSubcommand: 'apply',
    subcommandArguments: [
      'apply',
      '-input=false',
      '-no-color',
      '-auto-approve',
      `-var-file=${options.tfvarsPath}`,
    ],
    // The only run the Cloudflare token reaches; init and output talk to the state bucket alone.
    withCloudflareApiToken: true,
  })
  if (applyRun.kind === 'tofu-subcommand-failed') {
    return applyRun.failure
  }

  // `tofu output` takes no -input flag, unlike init and apply, and refuses to parse one.
  const outputRun = await runTofuSubcommand({
    ...options,
    tofuSubcommand: 'output',
    subcommandArguments: ['output', '-no-color', '-json'],
    withCloudflareApiToken: false,
  })
  if (outputRun.kind === 'tofu-subcommand-failed') {
    return outputRun.failure
  }

  const outputsRead = readTofuOutputValues(outputRun.standardOutput)
  if (outputsRead.kind === 'tofu-output-values-unusable') {
    return {
      kind: 'tofu-run-failed',
      tofuSubcommand: 'output',
      detail: redactInfraApplySecrets(outputsRead.detail, secretValuesOf(options.secrets)),
    }
  }
  return { kind: 'tofu-run-succeeded', moduleOutputs: outputsRead.moduleOutputs }
}

/** One tofu run's outcome: what it printed, or the failure the command reports for it. */
type TofuSubcommandRun =
  | { kind: 'tofu-subcommand-succeeded'; standardOutput: string }
  | {
      kind: 'tofu-subcommand-failed'
      failure: Extract<CloudflareTofuModuleRun, { kind: 'tofu-run-failed' }>
    }

/** Spawns one tofu subcommand against the shipped module with the child environment that subcommand is allowed. */
async function runTofuSubcommand(options: {
  context: CliRuntimeContext
  secrets: InfraApplySecretValues
  tofuSubcommand: TofuSubcommand
  subcommandArguments: readonly string[]
  withCloudflareApiToken: boolean
}): Promise<TofuSubcommandRun> {
  const outcome = await runChildProcessCommand({
    commandName: 'tofu',
    commandArguments: [
      `-chdir=${cloudflareTofuModuleDirectoryPath}`,
      ...options.subcommandArguments,
    ],
    context: {
      workingDirectoryPath: options.context.workingDirectoryPath,
      environmentVariables: buildTofuChildEnvironment(options),
    },
  })

  if (outcome.kind === 'child-process-not-on-path') {
    return {
      kind: 'tofu-subcommand-failed',
      failure: {
        kind: 'tofu-run-failed',
        tofuSubcommand: options.tofuSubcommand,
        detail:
          'tofu was not found on PATH; install OpenTofu 1.12.6 (brew install opentofu) and run hearthkit doctor',
      },
    }
  }
  if (outcome.exitCode !== 0) {
    const reportedText = (outcome.standardError.trim() || outcome.standardOutput.trim()).slice(
      0,
      tofuFailureDetailLimit,
    )
    return {
      kind: 'tofu-subcommand-failed',
      failure: {
        kind: 'tofu-run-failed',
        tofuSubcommand: options.tofuSubcommand,
        detail: redactInfraApplySecrets(
          reportedText === ''
            ? `tofu ${options.tofuSubcommand} exited ${String(outcome.exitCode)} with no diagnostic output`
            : reportedText,
          secretValuesOf(options.secrets),
        ),
      },
    }
  }

  return { kind: 'tofu-subcommand-succeeded', standardOutput: outcome.standardOutput }
}

/**
 * The environment one tofu child gets: the CLI's own, with the Cloudflare token removed unless this
 * subcommand is the one allowed to have it, plus the state credentials the s3 backend reads, the
 * passphrase the encryption block reads, and the project's data directory.
 */
function buildTofuChildEnvironment(options: {
  context: CliRuntimeContext
  secrets: InfraApplySecretValues
  withCloudflareApiToken: boolean
}): Record<string, string | undefined> {
  const childEnvironment: Record<string, string | undefined> = {
    ...options.context.environmentVariables,
    AWS_ACCESS_KEY_ID: options.secrets.tofuStateAccessKeyId,
    AWS_SECRET_ACCESS_KEY: options.secrets.tofuStateSecretAccessKey,
    TF_VAR_state_passphrase: options.secrets.tofuStatePassphrase,
    TF_DATA_DIR: resolve(
      options.context.workingDirectoryPath,
      ...projectTofuDataDirectoryPath.split('/'),
    ),
  }
  delete childEnvironment[cloudflareApiTokenEnvVariableName]
  if (options.withCloudflareApiToken) {
    childEnvironment[cloudflareApiTokenEnvVariableName] = options.secrets.cloudflareApiToken
  }
  return childEnvironment
}

/** The four secret values as a list, which is the only shape the redactor needs them in. */
function secretValuesOf(secrets: InfraApplySecretValues): string[] {
  return [
    secrets.cloudflareApiToken,
    secrets.tofuStateAccessKeyId,
    secrets.tofuStateSecretAccessKey,
    secrets.tofuStatePassphrase,
  ]
}
