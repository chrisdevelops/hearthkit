import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

/**
 * Reads the package manifest and runs the JSX-free contract modules under a bare node process. Both
 * live here rather than in a gate so gate files keep to the contract module, the fixtures and Vitest,
 * and never reach for a node builtin of their own.
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
// Both must load under bare node: email-contract-entry.ts is what the ./email-contract subpath
// resolves to, and it re-exports from email-contract.ts, which the implementation imports directly.
const bareNodeEmailModuleUrls = [
  new URL('../src/email-contract.ts', import.meta.url),
  new URL('../src/email-contract-entry.ts', import.meta.url),
] as const

/** The manifest as JSON, or a named error saying it does not exist yet, which is the pre-implementation state. */
export async function readEmailPackageManifest(): Promise<EmailPackageManifest> {
  let manifestText: string
  try {
    manifestText = await readFile(emailPackageManifestUrl, 'utf8')
  } catch (error) {
    throw new Error(
      `gate expected a package manifest at ${fileURLToPath(emailPackageManifestUrl)} (not implemented yet?): ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
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
 * Runs every JSX-free email module under a plain node process, which is what the ./email-contract
 * subpath exists to make possible: the `.` entry transitively imports .tsx template modules that node
 * refuses, while these files import zod and a type-only react specifier and must load on their own.
 * Stops at the first module that does not exit 0 and names it, so a failure says which file broke.
 */
export async function runEmailContractUnderBareNode(): Promise<BareNodeRun> {
  const standardErrorReports: string[] = []
  for (const moduleUrl of bareNodeEmailModuleUrls) {
    const run = await runOneFileUnderBareNode(moduleUrl)
    standardErrorReports.push(`${fileURLToPath(moduleUrl)}: ${run.standardError}`)
    if (run.exitCode !== 0) {
      return { exitCode: run.exitCode, standardError: standardErrorReports.join('\n') }
    }
  }
  return { exitCode: 0, standardError: standardErrorReports.join('\n') }
}

async function runOneFileUnderBareNode(moduleUrl: URL): Promise<BareNodeRun> {
  const child = spawn(process.execPath, [fileURLToPath(moduleUrl)], {
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
