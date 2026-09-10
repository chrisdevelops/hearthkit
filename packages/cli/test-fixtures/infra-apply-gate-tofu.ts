import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { chmod, cp, mkdir, mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'

/**
 * Everything a `hearthkit infra apply` gate needs that is not itself contract: the public-entry
 * loader for the infra constants, a way to run the real `tofu` binary against a throwaway copy of
 * the provider module, the plan-JSON shape the module gates read, and the `tofu` shim that proves
 * no child process started.
 *
 * Nothing here mocks hearthkit code. The shim is a fake external binary, the same device the dev
 * gates already use for `next`, and it exists so a gate can prove the CLI stopped *before* spawning
 * `tofu` rather than merely that it returned the right kind.
 */

const runExecutableFile = promisify(execFile)

/** The infra apply constants a gate reads, loaded from the public entry point because the contract lists them as values consumers grep for. */
export type HearthkitCliInfraExports = {
  cliInfraProviderUnsupportedErrorPrefix: string
  cliInfraEnvMissingErrorPrefix: string
  cliInfraTfvarsIncompleteErrorPrefix: string
  cliInfraEnvProductionExampleMissingErrorPrefix: string
  cliInfraTofuFailedErrorPrefix: string
  infraProviderEnvVariableName: string
  cloudflareApiTokenEnvVariableName: string
  tofuStateAccessKeyIdEnvVariableName: string
  tofuStateSecretAccessKeyEnvVariableName: string
  tofuStatePassphraseEnvVariableName: string
  defaultInfraTfvarsPath: string
  envProductionExamplePath: string
  tofuStatePassphraseMinimumLength: number
}

const expectedInfraStringExportNames = [
  'cliInfraProviderUnsupportedErrorPrefix',
  'cliInfraEnvMissingErrorPrefix',
  'cliInfraTfvarsIncompleteErrorPrefix',
  'cliInfraEnvProductionExampleMissingErrorPrefix',
  'cliInfraTofuFailedErrorPrefix',
  'infraProviderEnvVariableName',
  'cloudflareApiTokenEnvVariableName',
  'tofuStateAccessKeyIdEnvVariableName',
  'tofuStateSecretAccessKeyEnvVariableName',
  'tofuStatePassphraseEnvVariableName',
  'defaultInfraTfvarsPath',
  'envProductionExamplePath',
] as const

/**
 * Loads the infra apply constants from @hearthkit/cli at call time, so a package that has not
 * re-exported them yet fails one gate at a time instead of breaking collection for the whole file.
 * It refuses anything missing because this repo's Vitest resolves an absent named export to
 * undefined, and a prefix compared against undefined would go green while asserting nothing.
 */
export async function loadHearthkitCliInfraExports(): Promise<HearthkitCliInfraExports> {
  let loaded: unknown
  try {
    loaded = await import('@hearthkit/cli')
  } catch (error) {
    throw new Error(
      `gate could not load the public entry point of @hearthkit/cli (not implemented yet?): ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }

  const namespace = loaded as Partial<Record<keyof HearthkitCliInfraExports, unknown>>
  const missingExportNames: string[] = expectedInfraStringExportNames.filter((exportName) => {
    const value = namespace[exportName]
    return typeof value !== 'string' || value.length === 0
  })
  if (typeof namespace.tofuStatePassphraseMinimumLength !== 'number') {
    missingExportNames.push('tofuStatePassphraseMinimumLength')
  }
  if (missingExportNames.length > 0) {
    throw new Error(
      `gate expected @hearthkit/cli to export ${missingExportNames.join(', ')} from its public entry point`,
    )
  }

  return namespace as HearthkitCliInfraExports
}

/** The exact provider pin infra/tofu/PROVIDER-CONTRACT.md requires, as it appears in a saved plan's provider_config; not a cli contract value, so it lives here. */
export const cloudflareProviderVersionConstraint = '5.24.0'

/** The four managed resource types the module plans, one each, per infra/tofu/PROVIDER-CONTRACT.md "Resources, exactly four, no data source"; resource *names* are the implementor's choice, so gates match on type. */
export const expectedCloudflareModuleResourceTypes = [
  'cloudflare_api_token',
  'cloudflare_dns_record',
  'cloudflare_r2_bucket',
  'cloudflare_r2_bucket_cors',
] as const

/** Placeholder values for the five operator inputs; syntactically real ids and an IPv4 from the documentation ranges, so a plan is shaped like a real one while reaching no account. */
export const tofuGatePlaceholderModuleInputs = {
  project_name: 'hearthkitgateproject',
  zone_name: 'gate-example.com',
  zone_id: '023e105f4ecef8ad9ca31a8372d0c353',
  account_id: 'f037e56e89293a057740de681ac9abbe',
  host_ip: '203.0.113.10',
} as const satisfies Record<string, string>

/** A state passphrase comfortably over OpenTofu's pbkdf2 minimum; the plan gates need one because the module's encryption block reads it. */
export const tofuGateStatePassphrase = 'hearthkit-gate-passphrase-0123456789'

/** A dummy Cloudflare token: `tofu plan` on create-only resources calls no API, so this never reaches Cloudflare. */
export const tofuGateDummyCloudflareApiToken = 'dummy'

/** What running one `tofu` command produced; a nonzero exit is a value so a gate can quote the real output in its own failure message. */
export type TofuGateCommandOutcome = {
  exitCode: number
  standardOutput: string
  standardError: string
}

/**
 * Builds the environment for a direct `tofu` invocation from a gate: the process environment with
 * every `TF_*` and `CLOUDFLARE_*` variable dropped first, so a developer's own OpenTofu settings
 * cannot change what the gate measures.
 */
function tofuGateEnvironment(overrides: Record<string, string>): Record<string, string> {
  const environment: Record<string, string> = {}
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined || name.startsWith('TF_') || name.startsWith('CLOUDFLARE_')) {
      continue
    }
    environment[name] = value
  }
  return { ...environment, ...overrides }
}

/** Runs the real `tofu` binary and returns its exit code and streams; never throws for a nonzero exit, so the gate decides what a failure means. */
export async function runTofuGateCommand(options: {
  commandArguments: readonly string[]
  tofuDataDirectoryPath: string
}): Promise<TofuGateCommandOutcome> {
  const environment = tofuGateEnvironment({
    TF_DATA_DIR: options.tofuDataDirectoryPath,
    TF_PLUGIN_CACHE_DIR: await ensureTofuGatePluginCacheDirectory(),
    TF_IN_AUTOMATION: '1',
    TF_VAR_state_passphrase: tofuGateStatePassphrase,
    CLOUDFLARE_API_TOKEN: tofuGateDummyCloudflareApiToken,
  })

  try {
    const { stdout, stderr } = await runExecutableFile('tofu', [...options.commandArguments], {
      env: environment,
      maxBuffer: 32 * 1024 * 1024,
    })
    return { exitCode: 0, standardOutput: stdout, standardError: stderr }
  } catch (error) {
    const failed = error as { code?: unknown; stdout?: string; stderr?: string; message?: string }
    if (typeof failed.code !== 'number') {
      throw new Error(
        `gate could not run tofu ${options.commandArguments.join(' ')} (is OpenTofu 1.12.6 on PATH?): ${failed.message ?? String(error)}`,
        { cause: error },
      )
    }
    return {
      exitCode: failed.code,
      standardOutput: failed.stdout ?? '',
      standardError: failed.stderr ?? '',
    }
  }
}

/**
 * One provider download shared by every run on this machine. OpenTofu treats the plugin cache as a
 * cache and not as state, so it is deliberately not removed between runs: without it each gate
 * re-downloads the whole cloudflare provider.
 */
async function ensureTofuGatePluginCacheDirectory(): Promise<string> {
  const cacheDirectoryPath = join(tmpdir(), 'hearthkit-cli-gate-tofu-plugin-cache')
  await mkdir(cacheDirectoryPath, { recursive: true })
  return cacheDirectoryPath
}

/** A throwaway, initialized copy of the provider module plus the data directory its `.terraform` lives in. */
export type TofuModuleGateCopy = {
  gateRootPath: string
  moduleCopyPath: string
  tofuDataDirectoryPath: string
  removeCopy: () => Promise<void>
}

/**
 * Copies the provider module out of the repo and runs `tofu init` on the copy, so a gate never
 * writes `.terraform` or a lock file into `packages/cli/tofu/cloudflare`, and so a stale committed
 * lock file cannot decide which provider build a gate resolves.
 *
 * `localBackendOverride` adds an OpenTofu `*_override.tf` file replacing the module's `s3` backend
 * with `local`. OpenTofu refuses `plan` while a configured backend has never been initialized, and
 * initializing the real one needs the operator's R2 state bucket, so the plan gate overrides the
 * backend rather than reaching a Cloudflare account. `validate` needs no backend and gets no
 * override, which is why the module's own backend block is still the one that gate reads.
 */
export async function prepareTofuModuleGateCopy(options: {
  moduleDirectoryPath: string
  purpose: string
  localBackendOverride: boolean
}): Promise<TofuModuleGateCopy> {
  const moduleDirectoryExists = await stat(options.moduleDirectoryPath)
    .then((entry) => entry.isDirectory())
    .catch(() => false)
  if (!moduleDirectoryExists) {
    throw new Error(
      `gate expected the cloudflare OpenTofu module directory at ${options.moduleDirectoryPath} (not implemented yet?)`,
    )
  }

  const gateRootPath = await realpath(
    await mkdtemp(join(tmpdir(), `hearthkit-cli-gate-tofu-${options.purpose}-`)),
  )
  const moduleCopyPath = join(gateRootPath, 'cloudflare')
  const tofuDataDirectoryPath = join(gateRootPath, 'tofu-data')
  const removeCopy = async () => {
    await rm(gateRootPath, { recursive: true, force: true })
  }

  await cp(options.moduleDirectoryPath, moduleCopyPath, {
    recursive: true,
    // The provider cache and the lock file are init output, never module source.
    filter: (source) => {
      const entryName = basename(source)
      return entryName !== '.terraform' && entryName !== '.terraform.lock.hcl'
    },
  })

  const initArguments = ['-chdir=' + moduleCopyPath, 'init', '-input=false', '-no-color']
  if (options.localBackendOverride) {
    await writeFile(
      join(moduleCopyPath, 'zz-hearthkit-gate_override.tf'),
      'terraform {\n  backend "local" {}\n}\n',
      'utf8',
    )
  } else {
    initArguments.splice(2, 0, '-backend=false')
  }

  const initOutcome = await runTofuGateCommand({
    commandArguments: initArguments,
    tofuDataDirectoryPath,
  })
  if (initOutcome.exitCode !== 0) {
    await removeCopy()
    throw new Error(
      `gate could not run tofu init on the module copy (exit ${initOutcome.exitCode}): ${initOutcome.standardError || initOutcome.standardOutput}`,
    )
  }

  return { gateRootPath, moduleCopyPath, tofuDataDirectoryPath, removeCopy }
}

/** Fails the gate with tofu's own output when a `tofu` command a module gate depends on did not exit 0, so a broken module reads as a module failure and not as an undefined comparison later. */
export function expectTofuGateCommandSucceeded(
  outcome: TofuGateCommandOutcome,
  description: string,
): void {
  if (outcome.exitCode !== 0) {
    throw new Error(
      `gate expected ${description} to exit 0, received ${outcome.exitCode}: ${outcome.standardError || outcome.standardOutput}`,
    )
  }
}

const tofuPlanResourceSchema = z.object({
  address: z.string(),
  mode: z.string(),
  type: z.string(),
})

/** The slice of `tofu show -json <plan>` the module gates read; parsing it turns a changed OpenTofu output format into a named failure instead of an undefined comparison. */
export const tofuPlanJsonSchema = z.object({
  planned_values: z.object({
    root_module: z.object({
      resources: z.array(tofuPlanResourceSchema).optional(),
      child_modules: z.array(z.unknown()).optional(),
    }),
  }),
  resource_changes: z.array(
    tofuPlanResourceSchema.extend({ change: z.object({ actions: z.array(z.string()) }) }),
  ),
  configuration: z.object({
    provider_config: z.record(
      z.string(),
      z.object({ name: z.string(), version_constraint: z.string().optional() }),
    ),
  }),
})

/** The parsed plan slice a gate asserts on. */
export type TofuPlanJson = z.infer<typeof tofuPlanJsonSchema>

/**
 * Every address in the raw plan JSON belonging to an object whose `mode` is `data`. The walk runs
 * over the untouched JSON rather than the parsed slice, because parsing drops unknown keys and a
 * data source could hide under one of them.
 */
export function findTofuPlanDataModeAddresses(planJsonValue: unknown): string[] {
  const dataModeAddresses: string[] = []
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item)
      }
      return
    }
    if (value === null || typeof value !== 'object') {
      return
    }
    const record = value as Record<string, unknown>
    if (record.mode === 'data') {
      dataModeAddresses.push(typeof record.address === 'string' ? record.address : 'unnamed')
    }
    for (const nested of Object.values(record)) {
      visit(nested)
    }
  }
  visit(planJsonValue)
  return dataModeAddresses
}

/** The `tofu` stand-in and the file it writes when it runs; the marker existing at all means a child process started. */
export type GateTofuShim = {
  shimDirectoryPath: string
  markerFilePath: string
  wasInvoked: () => Promise<boolean>
}

/**
 * Writes an executable named `tofu` into a directory of its own and returns it, so a gate can make
 * that directory the whole PATH. The shim records its arguments and exits 0: a gate that expects no
 * `tofu` at all proves it by the marker file never appearing, not by the exit code.
 */
export async function writeGateTofuShim(directoryPath: string): Promise<GateTofuShim> {
  const shimDirectoryPath = join(directoryPath, `gate-tofu-shim-${randomUUID().slice(0, 8)}`)
  await mkdir(shimDirectoryPath, { recursive: true })
  const markerFilePath = join(shimDirectoryPath, 'gate-tofu-was-invoked.txt')
  const shimPath = join(shimDirectoryPath, 'tofu')
  await writeFile(
    shimPath,
    [
      '#!/bin/sh',
      `printf 'gate tofu shim ran with: %s\\n' "$*" >> '${markerFilePath}'`,
      'exit 0',
      '',
    ].join('\n'),
    'utf8',
  )
  await chmod(shimPath, 0o755)

  return {
    shimDirectoryPath,
    markerFilePath,
    wasInvoked: async () =>
      stat(markerFilePath)
        .then(() => true)
        .catch(() => false),
  }
}

/** Writes the project's `infra/tofu.tfvars` in the shape @hearthkit/create scaffolds it: one commented assignment per module input, a blank value standing for an unfilled placeholder. */
export async function writeGateTfvarsFile(options: {
  directoryPath: string
  relativeTfvarsPath: string
  variableValues: Record<string, string>
}): Promise<string> {
  const tfvarsPath = join(options.directoryPath, options.relativeTfvarsPath)
  await mkdir(dirname(tfvarsPath), { recursive: true })
  const fileLines = Object.entries(options.variableValues).flatMap(([name, value]) => [
    `# ${name}: written by the operator before hearthkit infra apply`,
    `${name} = "${value}"`,
  ])
  await writeFile(tfvarsPath, `${fileLines.join('\n')}\n`, 'utf8')
  return tfvarsPath
}

/** Writes the `.env.production.example` infra apply rewrites, so the tfvars and env gates fail on the check they name and not on the file check that follows it. */
export async function writeGateEnvProductionExampleFile(options: {
  directoryPath: string
  relativeEnvProductionExamplePath: string
}): Promise<string> {
  const filePath = join(options.directoryPath, options.relativeEnvProductionExamplePath)
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(
    filePath,
    [
      '# Production variables. Paste the values into Dokploy; this file holds no secret.',
      'STORAGE_ENDPOINT=',
      'STORAGE_BUCKET=',
      'STORAGE_ACCESS_KEY_ID=',
      'STORAGE_SECRET_ACCESS_KEY=',
      'STORAGE_REGION=',
      '# Copy the project DSN from GlitchTip.',
      'GLITCHTIP_DSN=',
      '',
    ].join('\n'),
    'utf8',
  )
  return filePath
}
