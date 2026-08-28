import { execFile } from 'node:child_process'
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
