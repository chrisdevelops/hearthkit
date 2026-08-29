import { execFile } from 'node:child_process'
import { createServer } from 'node:net'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** How long a gate lets one docker compose invocation run before it gives up and reports a timeout. */
const gateComposeTimeoutMilliseconds = 240_000

/** Enough buffer for a compose pull and health wait; the default 1 MB truncates and turns into a spurious failure. */
const gateComposeOutputBufferBytes = 16 * 1024 * 1024

/** One docker compose invocation: its real exit code and both streams, never routed through a pipeline. */
export type GateComposeOutcome = {
  exitCode: number
  standardOutput: string
  standardError: string
}

/**
 * Runs docker compose against one explicit file and resolves with its exit code rather than throwing,
 * so a gate can assert on the code itself. execFile is used deliberately: piping compose through
 * another command reports that command's status instead of compose's, which is how an earlier probe
 * of this very behaviour reached the wrong conclusion.
 */
export async function runGateComposeCommand(options: {
  composeFilePath: string
  composeArguments: readonly string[]
}): Promise<GateComposeOutcome> {
  try {
    const { stdout, stderr } = await execFileAsync(
      'docker',
      ['compose', '--file', options.composeFilePath, ...options.composeArguments],
      { timeout: gateComposeTimeoutMilliseconds, maxBuffer: gateComposeOutputBufferBytes },
    )
    return { exitCode: 0, standardOutput: stdout, standardError: stderr }
  } catch (error) {
    const failed = error as { code?: unknown; stdout?: string; stderr?: string; message?: string }
    return {
      exitCode: typeof failed.code === 'number' ? failed.code : 1,
      standardOutput: failed.stdout ?? '',
      standardError: failed.stderr ?? failed.message ?? '',
    }
  }
}

/**
 * Removes everything a gate's compose project created, volumes included, whatever state it is in.
 * The contract's own dev infra down keeps volumes, so a gate has to drop them itself or the next run
 * inherits the bucket this one made and stops proving anything.
 */
export async function removeGateComposeProject(composeFilePath: string): Promise<void> {
  await runGateComposeCommand({
    composeFilePath,
    composeArguments: ['down', '--volumes', '--remove-orphans'],
  })
}

/**
 * A host port nothing is listening on right now, taken by binding port 0 and releasing it. Fixed
 * ports cannot be used here: the repo's own MinIO holds 9000 and 9001, and two gate runs at once
 * would collide on any other guess.
 */
export async function reserveFreeHostPort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const probeServer = createServer()
    probeServer.once('error', reject)
    probeServer.listen(0, '127.0.0.1', () => {
      const address = probeServer.address()
      if (address === null || typeof address === 'string') {
        probeServer.close(() =>
          reject(new Error('gate could not reserve a free host port for a MinIO gate stack')),
        )
        return
      }
      const { port } = address
      probeServer.close(() => resolve(port))
    })
  })
}

/**
 * Moves the generated minio host ports onto ports this gate reserved, leaving every other byte of
 * the generated file exactly as emitted. The contract fixes the published ports at 9000 and 9001,
 * which the repo's own MinIO already holds, so this is the only edit a gate makes to the file it is
 * testing; the internal http://minio:9000 the init container talks to is untouched.
 */
export function remapGeneratedMinioHostPorts(options: {
  composeFileContent: string
  s3HostPort: number
  consoleHostPort: number
}): string {
  const portRemappings = [
    { containerPort: 9000, hostPort: options.s3HostPort },
    { containerPort: 9001, hostPort: options.consoleHostPort },
  ] as const

  let remapped = options.composeFileContent
  for (const { containerPort, hostPort } of portRemappings) {
    const generatedPublishedPort = `${containerPort}:${containerPort}`
    if (!remapped.includes(generatedPublishedPort)) {
      throw new Error(
        `gate expected the generated compose file to publish minio port ${generatedPublishedPort} before remapping it onto a free host port`,
      )
    }
    remapped = remapped.replace(generatedPublishedPort, `${hostPort}:${containerPort}`)
  }
  return remapped
}
