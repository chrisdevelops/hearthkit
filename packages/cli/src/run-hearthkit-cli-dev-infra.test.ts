import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  expectCliFailure,
  expectCliSuccess,
  runHearthkitCliGate,
  singleStandardOutputLine,
} from '../test-fixtures/cli-run-expectations.ts'
import {
  gateContainerExists,
  gateContainerIsRunning,
  removeGateComposeNetworks,
  removeGateContainer,
} from '../test-fixtures/docker-gate-containers.ts'
import {
  remapGeneratedMailpitHostPorts,
  reserveFreeHostPort,
} from '../test-fixtures/gate-compose-project-runs.ts'
import {
  createEmptyPathDirectory,
  createGateDirectory,
  existingComposeFileContent,
  gateEnvironment,
  makeGateDirectoryReadOnly,
  removeGateDirectory,
  unbuildableComposeFileContent,
  uniqueGateProjectName,
  withPathReplaced,
  writeFakeNextBinary,
  writeGateComposeFile,
  writeGateProjectManifest,
} from '../test-fixtures/gate-project-directories.ts'
import { loadHearthkitCliEntry } from '../test-fixtures/hearthkit-cli-entry.ts'
import {
  cliComposeFileUnwritableErrorPrefix,
  cliDevInfraDownCompleteLinePrefix,
  cliDevInfraUpCompleteLinePrefix,
  cliDockerUnavailableErrorPrefix,
  cliInfraComposeFailedErrorPrefix,
  cliNextDevUnavailableErrorPrefix,
  cliProjectManifestMissingErrorPrefix,
  generateLocalInfraComposeOptionsSchema,
  localInfraServiceImageByName,
} from './cli-contract.ts'

const directoriesToRemove: string[] = []
const containersToRemove: string[] = []
const composeProjectNamesToClean: string[] = []

/** A throwaway project directory this file will remove, whatever the gate managed to write into it. */
async function gateProjectDirectory(purpose: string): Promise<string> {
  const directoryPath = await createGateDirectory(purpose)
  directoriesToRemove.push(directoryPath)
  return directoryPath
}

/** Registers a container name for the safety-net cleanup; each gate still removes its own before finishing. */
function gateContainerName(containerName: string): string {
  containersToRemove.push(containerName)
  return containerName
}

/**
 * A unique compose project name that is also registered for network cleanup. Compose names its
 * network after the project, which is the generated name when the CLI wrote the compose file and the
 * working directory name when it used one already there, so both candidates get registered.
 */
function gateComposeProjectName(purpose: string): string {
  const hearthkitProjectName = uniqueGateProjectName(purpose)
  composeProjectNamesToClean.push(hearthkitProjectName)
  return hearthkitProjectName
}

/**
 * One compose file with only its published mailpit host ports moved onto ports this run reserved.
 * Nothing else in the file changes: mailpit still listens on 1025 and 8025 inside the compose
 * network, so anything addressing it as mailpit:1025 is unaffected, and only the host side moves.
 */
async function remapMailpitHostPortsOntoFreePorts(composeFileContent: string): Promise<string> {
  const [smtpHostPort, webHostPort] = await Promise.all([
    reserveFreeHostPort(),
    reserveFreeHostPort(),
  ])
  if (smtpHostPort === webHostPort) {
    throw new Error('gate reserved the same host port twice for one Mailpit stack')
  }
  return remapGeneratedMailpitHostPorts({ composeFileContent, smtpHostPort, webHostPort })
}

/**
 * Writes the real generated mailpit compose file into a gate's project directory, published on
 * reserved ports. dev infra up never overwrites a compose file it finds, so these are exactly the
 * bytes it starts. Gates that claim the CLI writes this file generate it with the CLI instead.
 */
async function writeRemappedMailpitComposeFile(options: {
  directoryPath: string
  hearthkitProjectName: string
}): Promise<string> {
  const { generateLocalInfraCompose } = await loadHearthkitCliEntry()
  const generatedComposeFileContent = generateLocalInfraCompose(
    generateLocalInfraComposeOptionsSchema.parse({
      hearthkitProjectName: options.hearthkitProjectName,
      infraServices: ['mailpit'],
    }),
  )
  return writeGateComposeFile(
    options.directoryPath,
    await remapMailpitHostPortsOntoFreePorts(generatedComposeFileContent),
  )
}

afterAll(async () => {
  for (const containerName of containersToRemove) {
    await removeGateContainer(containerName)
  }
  await removeGateComposeNetworks([
    ...composeProjectNamesToClean,
    ...directoriesToRemove.map((directoryPath) => basename(directoryPath)),
  ])
  for (const directoryPath of directoriesToRemove) {
    await removeGateDirectory(directoryPath)
  }
})

// Every gate here uses mailpit rather than postgres, and every gate that needs a started service
// publishes it on a host port this run reserved. The generated compose file publishes fixed host
// ports for all three services, and the repo-root compose holds every one of them: 5432 for
// postgres, 9000 and 9001 for minio, and 1025 and 8025 for mailpit since the email package's gates
// arrived. Only the published host ports move; the ports the services listen on inside the compose
// network are the generated ones, so mailpit:1025 keeps meaning what it means in a real project.
describe('hearthkit dev and dev infra', () => {
  it('generates docker-compose.yml from the manifest and starts the services it names', async () => {
    const directoryPath = await gateProjectDirectory('infra-up')
    const hearthkitProjectName = gateComposeProjectName('up')
    await writeGateProjectManifest({
      directoryPath,
      manifestName: `@gate/${hearthkitProjectName}`,
      hearthkitDependencies: ['@hearthkit/email'],
    })
    const containerName = gateContainerName(`${hearthkitProjectName}-mailpit`)
    const composeFilePath = join(directoryPath, 'docker-compose.yml')
    const { generateLocalInfraCompose } = await loadHearthkitCliEntry()

    try {
      // The generating half. This run writes docker-compose.yml from the manifest and then asks
      // compose to start it on the generated host ports 1025 and 8025, which the repo's own Mailpit
      // holds — so whether compose can bind them depends on what else is running, and the exit code
      // is not this gate's claim. The bytes the CLI wrote do not depend on that, and they are
      // asserted in full below; a run that failed any earlier would leave no file to read.
      const generatingRun = await runHearthkitCliGate({
        argv: ['dev', 'infra', 'up'],
        cwd: directoryPath,
        env: gateEnvironment(),
      })
      expect(['dev-infra-up-succeeded', 'infra-compose-failed']).toContain(
        generatingRun.outcome.result.kind,
      )

      const composeFileContent = await readFile(composeFilePath, 'utf8')
      expect(composeFileContent).toContain(localInfraServiceImageByName.mailpit)
      expect(composeFileContent).not.toContain(localInfraServiceImageByName.postgres)
      // Byte for byte what the public generator emits for the one service @hearthkit/email selects,
      // under the project name the scoped manifest name @gate/<name> derives to.
      expect(composeFileContent).toBe(
        generateLocalInfraCompose(
          generateLocalInfraComposeOptionsSchema.parse({
            hearthkitProjectName,
            infraServices: ['mailpit'],
          }),
        ),
      )

      // The starting half. dev infra up never overwrites a compose file it finds, so the second run
      // starts exactly the file the first run generated, with only its published ports moved.
      await writeGateComposeFile(
        directoryPath,
        await remapMailpitHostPortsOntoFreePorts(composeFileContent),
      )
      const run = await runHearthkitCliGate({
        argv: ['dev', 'infra', 'up'],
        cwd: directoryPath,
        env: gateEnvironment(),
      })

      const success = expectCliSuccess(run, 'dev-infra-up-succeeded', 0)
      expect(success.startedInfraServices).toEqual(['mailpit'])
      expect(await gateContainerIsRunning(containerName)).toBe(true)
      const line = singleStandardOutputLine(run)
      expect(line.startsWith(cliDevInfraUpCompleteLinePrefix)).toBe(true)
      expect(line).toContain('mailpit')
    } finally {
      await removeGateContainer(containerName)
    }
  })

  it('never overwrites a docker-compose.yml that is already in the working directory', async () => {
    const directoryPath = await gateProjectDirectory('infra-existing')
    const hearthkitProjectName = gateComposeProjectName('existing')
    await writeGateProjectManifest({
      directoryPath,
      manifestName: hearthkitProjectName,
      hearthkitDependencies: ['@hearthkit/email'],
    })
    const containerName = gateContainerName(`${hearthkitProjectName}-existing-mailpit`)
    const writtenComposeFileContent = existingComposeFileContent(containerName)
    const composeFilePath = await writeGateComposeFile(directoryPath, writtenComposeFileContent)

    try {
      const run = await runHearthkitCliGate({
        argv: ['dev', 'infra', 'up'],
        cwd: directoryPath,
        env: gateEnvironment(),
      })

      const success = expectCliSuccess(run, 'dev-infra-up-succeeded', 0)
      // The hand-written file names one service, mailpit, which is a known local infra service, so
      // the compose service list filtered to known names is exactly that one.
      expect(success.startedInfraServices).toEqual(['mailpit'])
      expect(await readFile(composeFilePath, 'utf8')).toBe(writtenComposeFileContent)
      expect(await gateContainerIsRunning(containerName)).toBe(true)
    } finally {
      await removeGateContainer(containerName)
    }
  })

  it('stops and removes the services dev infra up started', async () => {
    const directoryPath = await gateProjectDirectory('infra-down')
    const hearthkitProjectName = gateComposeProjectName('down')
    await writeGateProjectManifest({
      directoryPath,
      manifestName: hearthkitProjectName,
      hearthkitDependencies: ['@hearthkit/email'],
    })
    // The generated file with only its published mailpit ports moved: what dev infra up starts here
    // is the real generated service, and what dev infra down has to remove.
    await writeRemappedMailpitComposeFile({ directoryPath, hearthkitProjectName })
    const containerName = gateContainerName(`${hearthkitProjectName}-mailpit`)

    try {
      expectCliSuccess(
        await runHearthkitCliGate({
          argv: ['dev', 'infra', 'up'],
          cwd: directoryPath,
          env: gateEnvironment(),
        }),
        'dev-infra-up-succeeded',
        0,
      )
      expect(await gateContainerIsRunning(containerName)).toBe(true)

      const run = await runHearthkitCliGate({
        argv: ['dev', 'infra', 'down'],
        cwd: directoryPath,
        env: gateEnvironment(),
      })

      expectCliSuccess(run, 'dev-infra-down-succeeded', 0)
      expect(singleStandardOutputLine(run).startsWith(cliDevInfraDownCompleteLinePrefix)).toBe(true)
      expect(await gateContainerExists(containerName)).toBe(false)
    } finally {
      await removeGateContainer(containerName)
    }
  })

  it('succeeds without doing anything when dev infra down finds no compose file in the directory', async () => {
    const directoryPath = await gateProjectDirectory('infra-down-noop')

    const run = await runHearthkitCliGate({
      argv: ['dev', 'infra', 'down'],
      cwd: directoryPath,
      env: gateEnvironment(),
    })

    expectCliSuccess(run, 'dev-infra-down-succeeded', 0)
    expect(singleStandardOutputLine(run).startsWith(cliDevInfraDownCompleteLinePrefix)).toBe(true)
  })

  it('brings infra up, runs the project next binary and exits with the code that binary exited with', async () => {
    const directoryPath = await gateProjectDirectory('dev-command')
    const hearthkitProjectName = gateComposeProjectName('dev')
    await writeGateProjectManifest({
      directoryPath,
      manifestName: hearthkitProjectName,
      hearthkitDependencies: ['@hearthkit/email'],
    })
    // The generated file with only its published mailpit ports moved, so dev brings up the real
    // generated service before it reaches the next binary.
    await writeRemappedMailpitComposeFile({ directoryPath, hearthkitProjectName })
    // A stand-in binary, not a mock of hearthkit code: it proves the exec happened and the exit code
    // travelled back without installing Next.js into a gate fixture.
    const { markerFilePath } = await writeFakeNextBinary({ directoryPath, exitCode: 7 })
    const containerName = gateContainerName(`${hearthkitProjectName}-mailpit`)

    try {
      const run = await runHearthkitCliGate({
        argv: ['dev'],
        cwd: directoryPath,
        env: gateEnvironment(),
      })

      const success = expectCliSuccess(run, 'dev-command-exited', 7)
      expect(success.nextDevExitCode).toBe(7)
      expect(await gateContainerIsRunning(containerName)).toBe(true)
      expect(await readFile(markerFilePath, 'utf8')).toContain('dev')
    } finally {
      await removeGateContainer(containerName)
    }
  })

  it('fails with docker-unavailable when no docker executable is on the path', async () => {
    const directoryPath = await gateProjectDirectory('no-docker')
    await writeGateProjectManifest({
      directoryPath,
      manifestName: uniqueGateProjectName('no-docker'),
      hearthkitDependencies: ['@hearthkit/email'],
    })
    const emptyPathDirectoryPath = await createEmptyPathDirectory()
    directoriesToRemove.push(emptyPathDirectoryPath)

    const run = await withPathReplaced(emptyPathDirectoryPath, () =>
      runHearthkitCliGate({
        argv: ['dev', 'infra', 'up'],
        cwd: directoryPath,
        env: gateEnvironment({ PATH: emptyPathDirectoryPath }),
      }),
    )

    const failure = expectCliFailure(run, 'docker-unavailable', 1)
    expect(failure.message.startsWith(cliDockerUnavailableErrorPrefix)).toBe(true)
    expect(run.standardError).toContain(failure.message)
  })

  it('fails with infra-compose-failed and carries the compose exit code when compose exits nonzero', async () => {
    const directoryPath = await gateProjectDirectory('compose-failed')
    await writeGateProjectManifest({
      directoryPath,
      manifestName: uniqueGateProjectName('compose-failed'),
      hearthkitDependencies: ['@hearthkit/email'],
    })
    await writeGateComposeFile(directoryPath, unbuildableComposeFileContent)

    const run = await runHearthkitCliGate({
      argv: ['dev', 'infra', 'up'],
      cwd: directoryPath,
      env: gateEnvironment(),
    })

    const failure = expectCliFailure(run, 'infra-compose-failed', 1)
    expect(failure.composeExitCode).not.toBe(0)
    expect(failure.composeStderrExcerpt.length).toBeGreaterThan(0)
    expect(failure.message.startsWith(cliInfraComposeFailedErrorPrefix)).toBe(true)
    expect(run.standardError).toContain(failure.message)
  })

  it('fails with project-manifest-missing when the working directory has no package.json', async () => {
    const directoryPath = await gateProjectDirectory('no-manifest')

    const run = await runHearthkitCliGate({
      argv: ['dev', 'infra', 'up'],
      cwd: directoryPath,
      env: gateEnvironment(),
    })

    const failure = expectCliFailure(run, 'project-manifest-missing', 1)
    expect(basename(failure.manifestPath)).toBe('package.json')
    expect(failure.manifestPath).toContain(basename(directoryPath))
    expect(failure.message.startsWith(cliProjectManifestMissingErrorPrefix)).toBe(true)
    expect(run.standardError).toContain(failure.message)
  })

  it('fails with compose-file-unwritable when the generated compose file cannot be written', async () => {
    const directoryPath = await gateProjectDirectory('read-only')
    await writeGateProjectManifest({
      directoryPath,
      manifestName: uniqueGateProjectName('read-only'),
      hearthkitDependencies: ['@hearthkit/email'],
    })
    await makeGateDirectoryReadOnly(directoryPath)

    const run = await runHearthkitCliGate({
      argv: ['dev', 'infra', 'up'],
      cwd: directoryPath,
      env: gateEnvironment(),
    })

    const failure = expectCliFailure(run, 'compose-file-unwritable', 1)
    expect(basename(failure.composeFilePath)).toBe('docker-compose.yml')
    expect(failure.message.startsWith(cliComposeFileUnwritableErrorPrefix)).toBe(true)
    expect(run.standardError).toContain(failure.message)
  })

  it('fails with next-dev-unavailable when the project has no next binary in node_modules', async () => {
    const directoryPath = await gateProjectDirectory('no-next')
    await writeGateProjectManifest({
      directoryPath,
      manifestName: uniqueGateProjectName('no-next'),
    })

    const run = await runHearthkitCliGate({
      argv: ['dev'],
      cwd: directoryPath,
      env: gateEnvironment(),
    })

    const failure = expectCliFailure(run, 'next-dev-unavailable', 1)
    expect(failure.message.startsWith(cliNextDevUnavailableErrorPrefix)).toBe(true)
    expect(run.standardError).toContain(failure.message)
  })
})
