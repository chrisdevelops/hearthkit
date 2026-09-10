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

/** Outcome of running one file under a plain node process, with the path and stderr kept so a failure explains itself. */
export type BareNodeRun = {
  modulePath: string
  exitCode: number | null
  standardError: string
}

const authPackageManifestUrl = new URL('../package.json', import.meta.url)
// Both must load under bare node: auth-contract-entry.ts is what the ./auth-contract subpath resolves
// to, and it re-exports from auth-contract.ts, which the implementation and these gates import direct.
const bareNodeAuthModuleUrls = [
  new URL('../src/auth-contract.ts', import.meta.url),
  new URL('../src/auth-contract-entry.ts', import.meta.url),
] as const

/** The manifest as JSON, or a named error saying it does not exist yet, which is the pre-implementation state. */
export async function readAuthPackageManifest(): Promise<AuthPackageManifest> {
  let manifestText: string
  try {
    manifestText = await readFile(authPackageManifestUrl, 'utf8')
  } catch (error) {
    throw new Error(
      `gate expected a package manifest at ${fileURLToPath(authPackageManifestUrl)} (not implemented yet?): ${error instanceof Error ? error.message : String(error)}`,
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
 * Runs every JSX-free auth module under a plain node process, one run per module, which is what the
 * ./auth-contract subpath exists to make possible: the `.` entry imports @hearthkit/email's `.` entry
 * and therefore .tsx template modules, plus better-auth/react and better-auth/next-js, while these two
 * files import zod at runtime and nothing else and must load on their own. @hearthkit/payments and
 * templates/app consume the subpath for AuthUserId, AuthOrganizationId, authApiBasePath and
 * hearthkitAuthTableNames without dragging React in behind them.
 */
export async function runAuthContractModulesUnderBareNode(): Promise<readonly BareNodeRun[]> {
  const runs: BareNodeRun[] = []
  for (const moduleUrl of bareNodeAuthModuleUrls) {
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
