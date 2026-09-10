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

/** Outcome of running one file under a plain node process, with the path and stderr kept so a failure explains itself. */
export type BareNodeRun = {
  modulePath: string
  exitCode: number | null
  standardError: string
}

const paymentsPackageManifestUrl = new URL('../package.json', import.meta.url)
// Both must load under bare node: payments-contract-entry.ts is what the ./payments-contract subpath
// resolves to, and it re-exports from payments-contract.ts, which the implementation and these gates
// import direct.
const bareNodePaymentsModuleUrls = [
  new URL('../src/payments-contract.ts', import.meta.url),
  new URL('../src/payments-contract-entry.ts', import.meta.url),
] as const

/** The manifest as JSON, or a named error saying it does not exist yet, which is the pre-implementation state. */
export async function readPaymentsPackageManifest(): Promise<PaymentsPackageManifest> {
  let manifestText: string
  try {
    manifestText = await readFile(paymentsPackageManifestUrl, 'utf8')
  } catch (error) {
    throw new Error(
      `gate expected a package manifest at ${fileURLToPath(paymentsPackageManifestUrl)} (not implemented yet?): ${error instanceof Error ? error.message : String(error)}`,
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
 * Runs every SDK-free payments module under a plain node process, one run per module, which is what
 * the ./payments-contract subpath exists to make possible: the `.` entry imports `stripe`,
 * `drizzle-orm/pg-core` and the Drizzle table definitions, while these two files import `zod` at
 * runtime and nothing else — their `stripe`, `drizzle-orm/node-postgres` and
 * `@hearthkit/auth/auth-contract` imports are all type-only and erased. The CLI's `hearthkit payments
 * sync` and templates/app's drizzle.config.ts read the contract this way without loading the SDK.
 */
export async function runPaymentsContractModulesUnderBareNode(): Promise<readonly BareNodeRun[]> {
  const runs: BareNodeRun[] = []
  for (const moduleUrl of bareNodePaymentsModuleUrls) {
    runs.push(await runOneFileUnderBareNode(moduleUrl))
  }
  return runs
}

async function runOneFileUnderBareNode(moduleUrl: URL): Promise<BareNodeRun> {
  const modulePath = fileURLToPath(moduleUrl)
  const child = spawn(process.execPath, [modulePath], {
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  const standardErrorChunks: string[] = []
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => standardErrorChunks.push(chunk))

  return new Promise<BareNodeRun>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (exitCode) => {
      resolve({ modulePath, exitCode, standardError: standardErrorChunks.join('') })
    })
  })
}
