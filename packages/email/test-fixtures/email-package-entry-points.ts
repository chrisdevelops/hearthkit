import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

/**
 * Reads the package manifest and runs the contract module under a bare node process. Both live here
 * rather than in a gate so gate files keep to the contract module, the fixtures and Vitest, and never
 * reach for a node builtin of their own.
 */

/** The manifest fields the contract makes promises about; everything else in package.json is ignored. */
export type EmailPackageManifest = {
  packageName: string | undefined
  exportsMap: Record<string, unknown>
}

/** Outcome of running one file under a plain node process, with stderr kept so a failure explains itself. */
export type BareNodeRun = {
  exitCode: number | null
  standardError: string
}

const emailPackageManifestUrl = new URL('../package.json', import.meta.url)
const emailContractModuleUrl = new URL('../src/email-contract.ts', import.meta.url)

/** The manifest as JSON, or a named error saying it does not exist yet, which is the pre-implementation state. */
export async function readEmailPackageManifest(): Promise<EmailPackageManifest> {
  let manifestText: string
  try {
    manifestText = await readFile(emailPackageManifestUrl, 'utf8')
  } catch (error) {
    throw new Error(
      `gate expected a package manifest at ${fileURLToPath(emailPackageManifestUrl)} (not implemented yet?): ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  const manifest = JSON.parse(manifestText) as Record<string, unknown>
  const exportsField = manifest.exports
  return {
    packageName: typeof manifest.name === 'string' ? manifest.name : undefined,
    exportsMap:
      typeof exportsField === 'object' && exportsField !== null
        ? (exportsField as Record<string, unknown>)
        : {},
  }
}

/**
 * Runs src/email-contract.ts under a plain node process, which is what the ./email-contract subpath
 * exists to make possible: the `.` entry transitively imports .tsx template modules that node refuses,
 * while the contract file is JSX-free and must load on its own.
 */
export async function runEmailContractUnderBareNode(): Promise<BareNodeRun> {
  const child = spawn(process.execPath, [fileURLToPath(emailContractModuleUrl)], {
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  const standardErrorChunks: string[] = []
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => standardErrorChunks.push(chunk))

  return new Promise<BareNodeRun>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (exitCode) => {
      resolve({ exitCode, standardError: standardErrorChunks.join('') })
    })
  })
}
