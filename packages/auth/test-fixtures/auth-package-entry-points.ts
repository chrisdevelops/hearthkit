import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

/**
 * Reads the package manifest and runs the contract module under a bare node process. Both live here
 * rather than in a gate so gate files keep to the contract module, the fixtures and Vitest, and never
 * reach for a node builtin of their own.
 */

/** The manifest fields the contract makes promises about; everything else in package.json is ignored. */
export type AuthPackageManifest = {
  packageName: string | undefined
  exportsMap: Record<string, unknown>
}

/** Outcome of running one file under a plain node process, with stderr kept so a failure explains itself. */
export type BareNodeRun = {
  exitCode: number | null
  standardError: string
}

const authPackageManifestUrl = new URL('../package.json', import.meta.url)
const authContractModuleUrl = new URL('../src/auth-contract.ts', import.meta.url)

/** The manifest as JSON, or a named error saying it does not exist yet, which is the pre-implementation state. */
export async function readAuthPackageManifest(): Promise<AuthPackageManifest> {
  let manifestText: string
  try {
    manifestText = await readFile(authPackageManifestUrl, 'utf8')
  } catch (error) {
    throw new Error(
      `gate expected a package manifest at ${fileURLToPath(authPackageManifestUrl)} (not implemented yet?): ${error instanceof Error ? error.message : String(error)}`,
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
 * Runs src/auth-contract.ts under a plain node process, which is what the ./auth-contract subpath
 * exists to make possible: the `.` entry imports @hearthkit/email's `.` entry and therefore .tsx
 * template modules, plus better-auth/react and better-auth/next-js, while the contract file imports
 * zod at runtime and nothing else and must load on its own. @hearthkit/payments consumes this subpath
 * in the next loop for AuthUserId and AuthOrganizationId without dragging React in behind them.
 */
export async function runAuthContractUnderBareNode(): Promise<BareNodeRun> {
  const child = spawn(process.execPath, [fileURLToPath(authContractModuleUrl)], {
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
