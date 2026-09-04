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
 * ports cannot be used here: the repo's own compose holds every host port the generated file
 * publishes — 9000 and 9001 for MinIO, 1025 and 8025 for Mailpit — and two gate runs at once would
 * collide on any other guess.
 */
export async function reserveFreeHostPort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const probeServer = createServer()
    probeServer.once('error', reject)
    probeServer.listen(0, '127.0.0.1', () => {
      const address = probeServer.address()
      if (address === null || typeof address === 'string') {
        probeServer.close(() =>
          reject(new Error('gate could not reserve a free host port for a compose gate stack')),
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
    // The digit guards are not decoration. A bare '9000:9000' search also matches inside
    // '19000:9000', so a generated file that published a different host port would pass the check
    // and be rewritten into the nonsense '1<port>:9000' instead of throwing.
    { publishedPortPattern: /(?<!\d)9000:9000(?!\d)/, port: 9000, hostPort: options.s3HostPort },
    {
      publishedPortPattern: /(?<!\d)9001:9001(?!\d)/,
      port: 9001,
      hostPort: options.consoleHostPort,
    },
  ] as const

  let remapped = options.composeFileContent
  for (const { publishedPortPattern, port, hostPort } of portRemappings) {
    if (!publishedPortPattern.test(remapped)) {
      throw new Error(
        `gate expected the generated compose file to publish minio port ${port}:${port} before remapping it onto a free host port`,
      )
    }
    remapped = remapped.replace(publishedPortPattern, `${hostPort}:${port}`)
  }
  return remapped
}

/**
 * Moves the generated mailpit host ports onto ports this gate reserved, leaving every other byte of
 * the generated file exactly as emitted. The contract fixes the published ports at 1025 and 8025,
 * which the repo's own Mailpit already holds, so this is the only edit a gate makes to the file it
 * is testing; the 1025 and 8025 mailpit itself listens on inside the compose network are untouched,
 * which is what a generated project's own services address as mailpit:1025.
 */
export function remapGeneratedMailpitHostPorts(options: {
  composeFileContent: string
  smtpHostPort: number
  webHostPort: number
}): string {
  const portRemappings = [
    // The digit guards are not decoration. A bare '8025:8025' search also matches inside
    // '18025:8025', so a generated file that published a different host port would pass the check
    // and be rewritten into the nonsense '1<port>:8025' instead of throwing.
    { publishedPortPattern: /(?<!\d)1025:1025(?!\d)/, port: 1025, hostPort: options.smtpHostPort },
    { publishedPortPattern: /(?<!\d)8025:8025(?!\d)/, port: 8025, hostPort: options.webHostPort },
  ] as const

  let remapped = options.composeFileContent
  for (const { publishedPortPattern, port, hostPort } of portRemappings) {
    if (!publishedPortPattern.test(remapped)) {
      throw new Error(
        `gate expected the generated compose file to publish mailpit port ${port}:${port} before remapping it onto a free host port`,
      )
    }
    remapped = remapped.replace(publishedPortPattern, `${hostPort}:${port}`)
  }
  return remapped
}
