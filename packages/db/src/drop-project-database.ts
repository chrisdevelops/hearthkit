import type { DropProjectDatabase, DropProjectDatabaseResult } from './db-contract.ts'
import { projectDatabaseNotFoundFailure } from './db-failure-results.ts'
import { withPostgresAdminSession } from './postgres-admin-session.ts'
import { postgresErrorToDbFailureOrThrow } from './postgres-error-to-db-failure.ts'
import { quotePostgresIdentifier } from './postgres-identifier-quoting.ts'
import { readProjectDatabasePresence } from './project-database-presence.ts'

/**
 * Drops the project database and its same-named role. Irreversible, and forced: live sessions on
 * the database are terminated rather than allowed to block the drop.
 */
export const dropProjectDatabase: DropProjectDatabase = async ({
  adminDatabaseUrl,
  projectDatabaseName,
}) => {
  const quotedName = quotePostgresIdentifier(projectDatabaseName)

  try {
    return await withPostgresAdminSession<DropProjectDatabaseResult>(
      adminDatabaseUrl,
      async (adminClient) => {
        const presence = await readProjectDatabasePresence(adminClient, projectDatabaseName)
        if (!presence.databaseExists) {
          return projectDatabaseNotFoundFailure(projectDatabaseName)
        }

        try {
          await adminClient.query(`DROP DATABASE ${quotedName} WITH (FORCE)`)
          if (presence.roleExists) {
            await adminClient.query(`DROP ROLE ${quotedName}`)
          }
        } catch (error) {
          return postgresErrorToDbFailureOrThrow(error)
        }

        return { kind: 'project-database-dropped', projectDatabaseName }
      },
    )
  } catch (error) {
    return postgresErrorToDbFailureOrThrow(error)
  }
}
