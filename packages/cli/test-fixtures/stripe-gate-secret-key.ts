import { readFile, stat } from 'node:fs/promises'
import { dirname, join, parse as parsePath } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Where the live payments sync gate gets its Stripe key, and how it cleans up after itself.
 *
 * The key is not optional here. Plan 4.8 lets a package skip its live gates without a key, but the
 * one gate that proves `hearthkit payments sync` reaches Stripe at all has nothing left if it skips,
 * and docs/STATUS.md records that a skipped gate is not a passing gate. So this throws a message
 * naming both places the key may come from rather than returning undefined.
 *
 * The repo-root `.env` is read directly because that is where the key lives locally (it is
 * git-ignored) and nothing in this workspace loads it into process.env; CI sets the environment
 * variable instead, which is why process.env wins when both are present.
 */

/** The Stripe API base for the archive calls below; a constant of the third-party service, not of this package. */
const stripeApiBaseUrl = 'https://api.stripe.com'

/** Key prefixes that identify a live-mode secret; a cheap pre-flight refusal, never the real guard, which is the measured stripeLivemode on the result. */
const liveStripeKeyPrefixes = ['sk_live_', 'rk_live_']

/** Walks up from this fixture to the workspace root, identified by the pnpm workspace file the repo defines itself with. */
async function findWorkspaceRootDirectory(): Promise<string | undefined> {
  let currentDirectory = dirname(fileURLToPath(import.meta.url))
  const filesystemRoot = parsePath(currentDirectory).root
  while (true) {
    const marker = join(currentDirectory, 'pnpm-workspace.yaml')
    const found = await stat(marker).then(
      () => true,
      () => false,
    )
    if (found) {
      return currentDirectory
    }
    if (currentDirectory === filesystemRoot) {
      return undefined
    }
    currentDirectory = dirname(currentDirectory)
  }
}

/** Reads one variable out of a dotenv file, handling comments, blank lines, `export ` prefixes and surrounding quotes; anything else is not this repo's `.env`. */
function readDotenvVariable(fileContent: string, variableName: string): string | undefined {
  for (const rawLine of fileContent.split('\n')) {
    const line = rawLine.trim().replace(/^export\s+/, '')
    if (line.length === 0 || line.startsWith('#')) {
      continue
    }
    const separatorIndex = line.indexOf('=')
    if (separatorIndex < 1 || line.slice(0, separatorIndex).trim() !== variableName) {
      continue
    }
    const value = line
      .slice(separatorIndex + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, '$2')
    return value.length > 0 ? value : undefined
  }
  return undefined
}

/**
 * The Stripe test-mode key, from the environment first and the git-ignored repo-root `.env` second,
 * refusing a live key before it is ever used. Throws with both sources named when there is none, so
 * the live gate fails loudly instead of quietly proving nothing.
 */
export async function readGateStripeSecretKey(): Promise<string> {
  const environmentValue = process.env.STRIPE_SECRET_KEY?.trim()
  const workspaceRootDirectory = await findWorkspaceRootDirectory()
  const dotenvPath =
    workspaceRootDirectory === undefined ? undefined : join(workspaceRootDirectory, '.env')
  const dotenvValue =
    dotenvPath === undefined
      ? undefined
      : await readFile(dotenvPath, 'utf8').then(
          (content) => readDotenvVariable(content, 'STRIPE_SECRET_KEY'),
          () => undefined,
        )

  const stripeSecretKey =
    environmentValue !== undefined && environmentValue.length > 0 ? environmentValue : dotenvValue
  if (stripeSecretKey === undefined || stripeSecretKey.length === 0) {
    throw new Error(
      `gate needs a Stripe test-mode STRIPE_SECRET_KEY and found none: set it in the environment, or put it in ${dotenvPath ?? 'the git-ignored repo-root .env'}. This gate does not skip, because a skipped gate is not a passing gate and nothing else here proves payments sync reaches Stripe.`,
    )
  }
  if (liveStripeKeyPrefixes.some((prefix) => stripeSecretKey.startsWith(prefix))) {
    throw new Error(
      'gate refuses to run against a live Stripe account: STRIPE_SECRET_KEY carries a live-mode prefix. Only a test-mode key may be used here.',
    )
  }
  return stripeSecretKey
}

/** Refuses to go any further when the account Stripe answered from is not in test mode; the measured guard, asserted on the result before anything else touches the account. */
export function assertGateStripeSyncWasTestMode(stripeLivemode: boolean): void {
  if (stripeLivemode) {
    throw new Error(
      'gate refuses to continue against a live Stripe account: the sync this run performed came back with livemode true, so STRIPE_SECRET_KEY is a live key and no gate here may touch it',
    )
  }
}

/** One Stripe API archive call; hygiene only, so a failure here never replaces a gate's own diagnostic. */
async function archiveGateStripeObject(
  stripeSecretKey: string,
  resourcePath: string,
): Promise<void> {
  try {
    await fetch(`${stripeApiBaseUrl}${resourcePath}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${stripeSecretKey}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'active=false',
    })
  } catch {
    // Cleanup is hygiene, not correctness: every name this run created is unique, so a repeat run
    // cannot collide with anything left behind.
  }
}

/**
 * Archives every price and product one sync created, over the Stripe REST API with plain fetch.
 * Prices cannot be deleted and a product holding prices cannot be deleted either, so `active: false`
 * is the whole of what cleanup can be.
 */
export async function archiveGateStripeSyncedPrices(
  stripeSecretKey: string,
  syncedPrices: readonly { stripePriceId: unknown; stripeProductId: unknown }[],
): Promise<void> {
  for (const syncedPrice of syncedPrices) {
    await archiveGateStripeObject(
      stripeSecretKey,
      `/v1/prices/${String(syncedPrice.stripePriceId)}`,
    )
  }
  for (const stripeProductId of new Set(
    syncedPrices.map((syncedPrice) => String(syncedPrice.stripeProductId)),
  )) {
    await archiveGateStripeObject(stripeSecretKey, `/v1/products/${stripeProductId}`)
  }
}
