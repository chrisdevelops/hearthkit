import { deriveLocalStorageBucketName, hearthkitProjectNameSchema } from '@hearthkit/cli'
import type { CreateCommandRecord, ResolvedHearthkitPackageName } from './create-contract.ts'

/**
 * Step seven: what a user does next, one line each.
 *
 * The two values that exist nowhere on disk are quoted here and nowhere else. `hearthkit db create`
 * prints its connection string once and persists it nothing, and the bucket name is derived from the
 * project name by the CLI so the compose file and `STORAGE_BUCKET` cannot drift. `create` writes no
 * `.env`, so the only way either reaches the user is this list.
 */

/** The lines create prints and returns as nextSteps, in the order a user works through them. */
export function buildProjectNextSteps(options: {
  projectName: string
  projectDirectoryPath: string
  resolvedPackages: readonly ResolvedHearthkitPackageName[]
  commandsRun: readonly CreateCommandRecord[]
}): string[] {
  const { resolvedPackages } = options
  const nextSteps = [
    `cd ${options.projectDirectoryPath}`,
    'copy .env.example to .env and fill in the values it marks as required',
  ]

  const databaseCreated = options.commandsRun.find(
    (commandRecord) => commandRecord.commandName === 'hearthkit db create',
  )
  if (databaseCreated?.commandName === 'hearthkit db create') {
    nextSteps.push(
      `  DATABASE_URL=${String(databaseCreated.connectionString)} (shown once, stored nowhere)`,
    )
  }
  if (resolvedPackages.includes('storage')) {
    nextSteps.push(
      `  STORAGE_BUCKET=${String(deriveLocalStorageBucketName(hearthkitProjectNameSchema.parse(options.projectName)))}`,
    )
  }
  if (resolvedPackages.includes('db')) {
    nextSteps.push('run pnpm db:generate, then hearthkit db migrate')
  }
  if (resolvedPackages.includes('payments')) {
    nextSteps.push(
      'run stripe listen --forward-to http://127.0.0.1:3000/api/payments/webhook and put the printed secret in STRIPE_WEBHOOK_SECRET',
    )
  }
  nextSteps.push('run pnpm dev')

  return nextSteps
}
