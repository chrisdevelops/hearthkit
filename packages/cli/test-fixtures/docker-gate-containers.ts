import { execFile } from 'node:child_process'
import { setTimeout as setTimeoutPromise } from 'node:timers/promises'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** True when a container with exactly this name is running right now, read from the real docker daemon. */
export async function gateContainerIsRunning(containerName: string): Promise<boolean> {
  const { stdout } = await execFileAsync('docker', [
    'ps',
    '--filter',
    `name=^${containerName}$`,
    '--format',
    '{{.Names}}',
  ])
  return stdout.split('\n').includes(containerName)
}

/** True when a container with exactly this name still exists in any state, so a gate can prove compose down removed it. */
export async function gateContainerExists(containerName: string): Promise<boolean> {
  const { stdout } = await execFileAsync('docker', [
    'ps',
    '--all',
    '--filter',
    `name=^${containerName}$`,
    '--format',
    '{{.Names}}',
  ])
  return stdout.split('\n').includes(containerName)
}

/** Force-removes a container a gate started, by name, so cleanup never depends on the CLI it is testing. */
export async function removeGateContainer(containerName: string): Promise<void> {
  await execFileAsync('docker', ['rm', '--force', '--volumes', containerName]).catch(
    () => undefined,
  )
}

/**
 * The compose project name for a name a gate chose: compose lowercases it and drops every character
 * outside [a-z0-9_-], which matters because mkdtemp directory suffixes are mixed case.
 */
function composeProjectNameFor(gateName: string): string {
  return gateName.toLowerCase().replaceAll(/[^a-z0-9_-]/g, '')
}

/**
 * Removes the <project>_default networks docker compose created for the named compose projects.
 * Removing only the container leaves the network behind, and docker runs out of address pools after
 * enough gate runs, so every gate that brings infra up has to drop its network as well.
 */
export async function removeGateComposeNetworks(composeProjectNames: string[]): Promise<void> {
  const { stdout } = await execFileAsync('docker', [
    'network',
    'ls',
    '--format',
    '{{.Name}}',
  ]).catch(() => ({ stdout: '' }))
  const existingNetworkNames = stdout.split('\n').map((line) => line.trim())
  const networkNamesToRemove = composeProjectNames
    .map((gateName) => `${composeProjectNameFor(gateName)}_default`)
    .filter((networkName) => existingNetworkNames.includes(networkName))
  for (const networkName of networkNamesToRemove) {
    // docker rm --force returns before the daemon has detached the container's endpoint, so the
    // first removal can fail with active endpoints; a few spaced attempts make the cleanup reliable.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const removed = await execFileAsync('docker', ['network', 'rm', networkName]).then(
        () => true,
        () => false,
      )
      if (removed) {
        break
      }
      await setTimeoutPromise(500)
    }
  }
}
