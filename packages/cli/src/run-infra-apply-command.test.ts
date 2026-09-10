import { randomUUID } from 'node:crypto'
import { isAbsolute, join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { expectCliFailure, runHearthkitCliGate } from '../test-fixtures/cli-run-expectations.ts'
import {
  createEmptyPathDirectory,
  createGateDirectory,
  removeGateDirectory,
  withPathReplaced,
} from '../test-fixtures/gate-project-directories.ts'
import {
  cloudflareProviderVersionConstraint,
  expectedCloudflareModuleResourceTypes,
  expectTofuGateCommandSucceeded,
  findTofuPlanDataModeAddresses,
  loadHearthkitCliInfraExports,
  prepareTofuModuleGateCopy,
  runTofuGateCommand,
  tofuGatePlaceholderModuleInputs,
  tofuPlanJsonSchema,
  writeGateEnvProductionExampleFile,
  writeGateTfvarsFile,
  writeGateTofuShim,
  type TofuModuleGateCopy,
} from '../test-fixtures/infra-apply-gate-tofu.ts'

/**
 * hearthkit infra apply, and the cloudflare OpenTofu module it runs.
 *
 * Every gate here is offline and needs no Cloudflare account. The two module gates run the real
 * `tofu` binary against a throwaway copy of the module and read the saved plan as JSON, so a
 * fifth resource or a data source fails them; the registry is the only thing they reach, once, to
 * download the pinned provider. The command gates cover every check that runs before `tofu` and the
 * one failure a missing `tofu` produces: they hand the CLI a PATH holding nothing but a `tofu` shim
 * that writes a marker file, and assert the marker is absent, which is how "before any tofu process
 * starts" is measured rather than assumed. Nothing here exercises a successful apply, which needs a
 * real Cloudflare account.
 *
 * The module lives inside this package (`packages/cli/tofu/cloudflare`) because it ships in the
 * published files, so the path is resolved from this file rather than from the repo root.
 */

/** The provider module as shipped; the CLI runs it with `tofu -chdir`, and so do these gates, against a copy. */
const cloudflareTofuModuleDirectoryPath = resolve(import.meta.dirname, '..', 'tofu', 'cloudflare')

let commandGateDirectoryPath: string
const preparedModuleCopies: TofuModuleGateCopy[] = []

beforeAll(async () => {
  commandGateDirectoryPath = await createGateDirectory('infra-apply')
})

afterAll(async () => {
  for (const moduleCopy of preparedModuleCopies) {
    await moduleCopy.removeCopy()
  }
  await removeGateDirectory(commandGateDirectoryPath)
})

describe('the cloudflare OpenTofu module', () => {
  it('passes tofu validate with exit code 0', async () => {
    // No backend override here: this copy is the module exactly as written, s3 backend block and
    // all, because validate needs no initialized backend and the gate should read the real file.
    const moduleCopy = await prepareTofuModuleGateCopy({
      moduleDirectoryPath: cloudflareTofuModuleDirectoryPath,
      purpose: 'validate',
      localBackendOverride: false,
    })
    preparedModuleCopies.push(moduleCopy)

    const validateOutcome = await runTofuGateCommand({
      commandArguments: [`-chdir=${moduleCopy.moduleCopyPath}`, 'validate', '-no-color'],
      tofuDataDirectoryPath: moduleCopy.tofuDataDirectoryPath,
    })

    expectTofuGateCommandSucceeded(validateOutcome, 'tofu validate on the cloudflare module')
    expect(validateOutcome.exitCode).toBe(0)
  }, 600_000)

  it('plans exactly one dns record, one r2 bucket, one api token and one cors rule, with no data source and the provider pinned at 5.24.0', async () => {
    const moduleCopy = await prepareTofuModuleGateCopy({
      moduleDirectoryPath: cloudflareTofuModuleDirectoryPath,
      purpose: 'plan',
      localBackendOverride: true,
    })
    preparedModuleCopies.push(moduleCopy)
    const planFilePath = join(moduleCopy.gateRootPath, 'gate-infra-apply.tfplan')

    // A dummy API token and placeholder ids: creating four resources needs no read call, so plan
    // reaches no account. The permission-group id inside the module is not validated at plan time.
    const planOutcome = await runTofuGateCommand({
      commandArguments: [
        `-chdir=${moduleCopy.moduleCopyPath}`,
        'plan',
        '-input=false',
        '-no-color',
        `-out=${planFilePath}`,
        ...Object.entries(tofuGatePlaceholderModuleInputs).map(
          ([variableName, value]) => `-var=${variableName}=${value}`,
        ),
      ],
      tofuDataDirectoryPath: moduleCopy.tofuDataDirectoryPath,
    })
    expectTofuGateCommandSucceeded(planOutcome, 'tofu plan on the cloudflare module')

    const showOutcome = await runTofuGateCommand({
      commandArguments: [`-chdir=${moduleCopy.moduleCopyPath}`, 'show', '-json', planFilePath],
      tofuDataDirectoryPath: moduleCopy.tofuDataDirectoryPath,
    })
    expectTofuGateCommandSucceeded(showOutcome, 'tofu show -json of the saved plan')

    // Read the plan as data. Grepping the text form would pass on a comment mentioning a resource.
    const rawPlanJson: unknown = JSON.parse(showOutcome.standardOutput)
    const planJson = tofuPlanJsonSchema.parse(rawPlanJson)

    const plannedResources = planJson.planned_values.root_module.resources ?? []
    expect([...plannedResources].map((resource) => resource.type).toSorted()).toEqual([
      ...expectedCloudflareModuleResourceTypes,
    ])
    expect(plannedResources.every((resource) => resource.mode === 'managed')).toBe(true)
    expect(planJson.planned_values.root_module.child_modules ?? []).toEqual([])

    expect([...planJson.resource_changes].map((change) => change.type).toSorted()).toEqual([
      ...expectedCloudflareModuleResourceTypes,
    ])
    expect(planJson.resource_changes.every((change) => change.mode === 'managed')).toBe(true)
    expect(
      planJson.resource_changes.every((change) => change.change.actions.join('+') === 'create'),
    ).toBe(true)

    // No data source anywhere: one would make the plan need a live account and network.
    expect(findTofuPlanDataModeAddresses(rawPlanJson)).toEqual([])

    expect(Object.keys(planJson.configuration.provider_config)).toEqual(['cloudflare'])
    expect(planJson.configuration.provider_config.cloudflare?.version_constraint).toBe(
      cloudflareProviderVersionConstraint,
    )
  }, 600_000)
})

describe('hearthkit infra apply', () => {
  it('fails with cli-infra-provider-unsupported before any tofu process starts when HEARTHKIT_INFRA_PROVIDER is unset or is another provider', async () => {
    const { cliInfraProviderUnsupportedErrorPrefix, infraProviderEnvVariableName } =
      await loadHearthkitCliInfraExports()
    const tofuShim = await writeGateTofuShim(commandGateDirectoryPath)

    // The shim directory is the whole PATH, in the env argument and in process.env, so whichever
    // one the CLI resolves the binary from, a spawned `tofu` writes the marker file.
    const unsetProviderRun = await withPathReplaced(tofuShim.shimDirectoryPath, () =>
      runHearthkitCliGate({
        argv: ['infra', 'apply'],
        cwd: commandGateDirectoryPath,
        env: { PATH: tofuShim.shimDirectoryPath },
      }),
    )

    expect(await tofuShim.wasInvoked()).toBe(false)
    const unsetProviderFailure = expectCliFailure(
      unsetProviderRun,
      'cli-infra-provider-unsupported',
      1,
    )
    // Unset carries no providerValue; there is no value to report.
    expect(unsetProviderFailure.providerValue).toBeUndefined()
    expect(unsetProviderFailure.message.startsWith(cliInfraProviderUnsupportedErrorPrefix)).toBe(
      true,
    )
    expect(unsetProviderRun.standardError).toContain(unsetProviderFailure.message)
    expect(unsetProviderRun.standardError).toContain(infraProviderEnvVariableName)
    expect(unsetProviderRun.standardOutput.trim()).toBe('')

    const otherProviderRun = await withPathReplaced(tofuShim.shimDirectoryPath, () =>
      runHearthkitCliGate({
        argv: ['infra', 'apply'],
        cwd: commandGateDirectoryPath,
        env: { PATH: tofuShim.shimDirectoryPath, [infraProviderEnvVariableName]: 'aws' },
      }),
    )

    expect(await tofuShim.wasInvoked()).toBe(false)
    const otherProviderFailure = expectCliFailure(
      otherProviderRun,
      'cli-infra-provider-unsupported',
      1,
    )
    expect(otherProviderFailure.providerValue).toBe('aws')
    expect(otherProviderFailure.message.startsWith(cliInfraProviderUnsupportedErrorPrefix)).toBe(
      true,
    )
    expect(otherProviderRun.standardError).toContain(otherProviderFailure.message)
  })

  it('names every blank tfvars input and every missing or too-short secret variable, before any tofu process starts', async () => {
    const {
      cliInfraEnvMissingErrorPrefix,
      cliInfraTfvarsIncompleteErrorPrefix,
      cloudflareApiTokenEnvVariableName,
      defaultInfraTfvarsPath,
      envProductionExamplePath,
      infraProviderEnvVariableName,
      tofuStateAccessKeyIdEnvVariableName,
      tofuStatePassphraseEnvVariableName,
      tofuStatePassphraseMinimumLength,
      tofuStateSecretAccessKeyEnvVariableName,
    } = await loadHearthkitCliInfraExports()
    // A directory of its own so the provider gate's marker file cannot answer for this one.
    const projectDirectoryPath = await createGateDirectory('infra-apply-inputs')
    const tofuShim = await writeGateTofuShim(projectDirectoryPath)

    try {
      // Present, so the example-file check that follows the two checks under test cannot fire.
      await writeGateEnvProductionExampleFile({
        directoryPath: projectDirectoryPath,
        relativeEnvProductionExamplePath: envProductionExamplePath,
      })
      const completeTfvarsValues: Record<string, string> = { ...tofuGatePlaceholderModuleInputs }
      const environmentWithEverySecret = {
        PATH: tofuShim.shimDirectoryPath,
        [infraProviderEnvVariableName]: 'cloudflare',
        [cloudflareApiTokenEnvVariableName]: 'gate-cloudflare-token',
        [tofuStateAccessKeyIdEnvVariableName]: 'gate-state-access-key-id',
        [tofuStateSecretAccessKeyEnvVariableName]: 'gate-state-secret-access-key',
        [tofuStatePassphraseEnvVariableName]: 'gate-state-passphrase-0123456789',
      }

      // One blank input, four filled: only the blank one is reported.
      const tfvarsPath = await writeGateTfvarsFile({
        directoryPath: projectDirectoryPath,
        relativeTfvarsPath: defaultInfraTfvarsPath,
        variableValues: { ...completeTfvarsValues, zone_id: '' },
      })
      const blankZoneIdRun = await withPathReplaced(tofuShim.shimDirectoryPath, () =>
        runHearthkitCliGate({
          argv: ['infra', 'apply'],
          cwd: projectDirectoryPath,
          env: environmentWithEverySecret,
        }),
      )

      expect(await tofuShim.wasInvoked()).toBe(false)
      const tfvarsFailure = expectCliFailure(blankZoneIdRun, 'cli-infra-tfvars-incomplete', 1)
      expect(tfvarsFailure.incompleteVariableNames).toEqual(['zone_id'])
      expect(isAbsolute(tfvarsFailure.tfvarsPath)).toBe(true)
      expect(tfvarsFailure.tfvarsPath).toBe(tfvarsPath)
      expect(tfvarsFailure.tfvarsPath).toBe(resolve(projectDirectoryPath, defaultInfraTfvarsPath))
      expect(tfvarsFailure.message.startsWith(cliInfraTfvarsIncompleteErrorPrefix)).toBe(true)
      expect(tfvarsFailure.message).toContain('zone_id')
      expect(blankZoneIdRun.standardError).toContain(tfvarsFailure.message)

      // Every input filled from here on, so the tfvars check can no longer be the one that fires.
      await writeGateTfvarsFile({
        directoryPath: projectDirectoryPath,
        relativeTfvarsPath: defaultInfraTfvarsPath,
        variableValues: completeTfvarsValues,
      })
      const everySecretVariableName = [
        cloudflareApiTokenEnvVariableName,
        tofuStateAccessKeyIdEnvVariableName,
        tofuStateSecretAccessKeyEnvVariableName,
        tofuStatePassphraseEnvVariableName,
      ]
      const noSecretsRun = await withPathReplaced(tofuShim.shimDirectoryPath, () =>
        runHearthkitCliGate({
          argv: ['infra', 'apply'],
          cwd: projectDirectoryPath,
          env: {
            PATH: tofuShim.shimDirectoryPath,
            [infraProviderEnvVariableName]: 'cloudflare',
          },
        }),
      )

      expect(await tofuShim.wasInvoked()).toBe(false)
      const noSecretsFailure = expectCliFailure(noSecretsRun, 'cli-infra-env-missing', 1)
      // All four together in one failure, not the first one found.
      expect([...noSecretsFailure.missingVariableNames].toSorted()).toEqual(
        [...everySecretVariableName].toSorted(),
      )
      expect(noSecretsFailure.message.startsWith(cliInfraEnvMissingErrorPrefix)).toBe(true)
      for (const variableName of everySecretVariableName) {
        expect(noSecretsRun.standardError).toContain(variableName)
      }

      // One character under the pbkdf2 minimum: present, so the reason has to be the length.
      const shortPassphraseRun = await withPathReplaced(tofuShim.shimDirectoryPath, () =>
        runHearthkitCliGate({
          argv: ['infra', 'apply'],
          cwd: projectDirectoryPath,
          env: {
            ...environmentWithEverySecret,
            [tofuStatePassphraseEnvVariableName]: 'p'.repeat(tofuStatePassphraseMinimumLength - 1),
          },
        }),
      )

      expect(await tofuShim.wasInvoked()).toBe(false)
      const shortPassphraseFailure = expectCliFailure(
        shortPassphraseRun,
        'cli-infra-env-missing',
        1,
      )
      expect(shortPassphraseFailure.missingVariableNames).toEqual([
        tofuStatePassphraseEnvVariableName,
      ])
      expect(shortPassphraseFailure.detail).toContain('shorter than 16 characters')
      expect(shortPassphraseFailure.message.startsWith(cliInfraEnvMissingErrorPrefix)).toBe(true)
      expect(shortPassphraseRun.standardError).toContain(tofuStatePassphraseEnvVariableName)
      expect(shortPassphraseRun.standardOutput.trim()).toBe('')
    } finally {
      await removeGateDirectory(projectDirectoryPath)
    }
  })

  it('fails with cli-infra-env-production-example-missing when the project has no example file, and with cli-infra-tofu-failed on init, scrubbed, when tofu is not on PATH', async () => {
    const {
      cliInfraEnvProductionExampleMissingErrorPrefix,
      cliInfraTofuFailedErrorPrefix,
      cloudflareApiTokenEnvVariableName,
      defaultInfraTfvarsPath,
      envProductionExamplePath,
      infraProviderEnvVariableName,
      tofuStateAccessKeyIdEnvVariableName,
      tofuStatePassphraseEnvVariableName,
      tofuStateSecretAccessKeyEnvVariableName,
    } = await loadHearthkitCliInfraExports()
    const projectDirectoryPath = await createGateDirectory('infra-apply-tofu-missing')
    const tofuShim = await writeGateTofuShim(projectDirectoryPath)

    try {
      // Every earlier check passes from here on, so the run reaches the two later ones in turn.
      await writeGateTfvarsFile({
        directoryPath: projectDirectoryPath,
        relativeTfvarsPath: defaultInfraTfvarsPath,
        variableValues: { ...tofuGatePlaceholderModuleInputs },
      })
      // Values nothing else in the run could produce, so finding one in `detail` can only mean the
      // CLI failed to scrub it.
      const gateRunSuffix = randomUUID().replaceAll('-', '').slice(0, 12)
      const everySecretValue = {
        [cloudflareApiTokenEnvVariableName]: `gate-cloudflare-token-${gateRunSuffix}`,
        [tofuStateAccessKeyIdEnvVariableName]: `gate-state-access-key-id-${gateRunSuffix}`,
        [tofuStateSecretAccessKeyEnvVariableName]: `gate-state-secret-access-key-${gateRunSuffix}`,
        [tofuStatePassphraseEnvVariableName]: `gate-state-passphrase-${gateRunSuffix}`,
      }

      // No .env.production.example yet, and a shim on PATH: the file check is specified to run
      // before any tofu process, so the shim must stay uninvoked.
      const missingExampleRun = await withPathReplaced(tofuShim.shimDirectoryPath, () =>
        runHearthkitCliGate({
          argv: ['infra', 'apply'],
          cwd: projectDirectoryPath,
          env: {
            PATH: tofuShim.shimDirectoryPath,
            [infraProviderEnvVariableName]: 'cloudflare',
            ...everySecretValue,
          },
        }),
      )

      expect(await tofuShim.wasInvoked()).toBe(false)
      const missingExampleFailure = expectCliFailure(
        missingExampleRun,
        'cli-infra-env-production-example-missing',
        1,
      )
      expect(isAbsolute(missingExampleFailure.envProductionExamplePath)).toBe(true)
      expect(missingExampleFailure.envProductionExamplePath).toBe(
        resolve(projectDirectoryPath, envProductionExamplePath),
      )
      expect(
        missingExampleFailure.message.startsWith(cliInfraEnvProductionExampleMissingErrorPrefix),
      ).toBe(true)
      expect(missingExampleRun.standardError).toContain(missingExampleFailure.message)
      expect(missingExampleRun.standardOutput.trim()).toBe('')

      // Every check now passes, so the run reaches tofu init — against a PATH holding no tofu at
      // all, not the shim, because a binary that is not there is the failure under test.
      const exampleFilePath = await writeGateEnvProductionExampleFile({
        directoryPath: projectDirectoryPath,
        relativeEnvProductionExamplePath: envProductionExamplePath,
      })
      expect(isAbsolute(exampleFilePath)).toBe(true)
      const emptyPathDirectoryPath = await createEmptyPathDirectory()

      try {
        const noTofuRun = await withPathReplaced(emptyPathDirectoryPath, () =>
          runHearthkitCliGate({
            argv: ['infra', 'apply'],
            cwd: projectDirectoryPath,
            env: {
              PATH: emptyPathDirectoryPath,
              [infraProviderEnvVariableName]: 'cloudflare',
              ...everySecretValue,
            },
          }),
        )

        const noTofuFailure = expectCliFailure(noTofuRun, 'cli-infra-tofu-failed', 1)
        // A tofu that is not on PATH is reported as the first subcommand, init.
        expect(noTofuFailure.tofuSubcommand).toBe('init')
        expect(noTofuFailure.message.startsWith(cliInfraTofuFailedErrorPrefix)).toBe(true)
        // The contract puts the message last on stderr, after any guidance, so that is the line
        // this asserts starts with the prefix rather than the whole stream.
        const lastStandardErrorLine = noTofuRun.standardError
          .split('\n')
          .filter((line) => line.trim().length > 0)
          .at(-1)
        expect(lastStandardErrorLine?.startsWith(cliInfraTofuFailedErrorPrefix)).toBe(true)
        expect(noTofuRun.standardError).toContain(noTofuFailure.message)
        // The four secrets reach child environments only; none of them may appear in the detail
        // the CLI quotes back, or in anything it printed.
        for (const secretValue of Object.values(everySecretValue)) {
          expect(noTofuFailure.detail).not.toContain(secretValue)
          expect(noTofuRun.standardError).not.toContain(secretValue)
          expect(noTofuRun.standardOutput).not.toContain(secretValue)
        }
      } finally {
        await removeGateDirectory(emptyPathDirectoryPath)
      }
    } finally {
      await removeGateDirectory(projectDirectoryPath)
    }
  })
})
