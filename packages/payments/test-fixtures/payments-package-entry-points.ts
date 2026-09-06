import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

/**
 * Reads the package manifest and runs the contract module under a bare node process. Both live here
 * rather than in a gate so gate files keep to the contract module, the fixtures and Vitest, and never
 * reach for a node builtin of their own.
 */

/** The manifest fields the contract makes promises about; everything else in package.json is ignored. */
export type PaymentsPackageManifest = {
  packageName: string | undefined
  exportsMap: Record<string, unknown>
}

/** Outcome of running one file under a plain node process, with stderr kept so a failure explains itself. */
export type BareNodeRun = {
  exitCode: number | null
  standardError: string
}

const paymentsPackageManifestUrl = new URL('../package.json', import.meta.url)
const paymentsContractModuleUrl = new URL('../src/payments-contract.ts', import.meta.url)

/** The manifest as JSON, or a named error saying it does not exist yet, which is the pre-implementation state. */
export async function readPaymentsPackageManifest(): Promise<PaymentsPackageManifest> {
  let manifestText: string
  try {
    manifestText = await readFile(paymentsPackageManifestUrl, 'utf8')
  } catch (error) {
    throw new Error(
      `gate expected a package manifest at ${fileURLToPath(paymentsPackageManifestUrl)} (not implemented yet?): ${error instanceof Error ? error.message : String(error)}`,
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
 * Runs src/payments-contract.ts under a plain node process, which is what the ./payments-contract
 * subpath exists to make possible: the `.` entry imports `stripe`, `drizzle-orm/pg-core` and the
 * Drizzle table definitions, while this file imports `zod` at runtime and nothing else — its
 * `stripe`, `drizzle-orm/node-postgres` and `@hearthkit/auth/auth-contract` imports are all type-only
 * and erased. The CLI's `hearthkit payments sync` and any later package read the contract this way
 * without loading the SDK.
 */
export async function runPaymentsContractUnderBareNode(): Promise<BareNodeRun> {
  const child = spawn(process.execPath, [fileURLToPath(paymentsContractModuleUrl)], {
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
