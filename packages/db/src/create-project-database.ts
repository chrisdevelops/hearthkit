import type { Client } from 'pg'
import type {
  CreateProjectDatabase,
  CreateProjectDatabaseResult,
  DbFailure,
  ProjectDatabaseName,
} from './db-contract.ts'
import { projectDatabaseAlreadyExistsFailure } from './db-failure-results.ts'
import { generateProjectRolePassword } from './generate-project-role-password.ts'
import {
  runAdminStatementIgnoringErrors,
  withPostgresAdminSession,
} from './postgres-admin-session.ts'
import { isPostgresDuplicateNameFailure } from './postgres-error-classification.ts'
import { postgresErrorToDbFailureOrThrow } from './postgres-error-to-db-failure.ts'
import {
  quotePostgresIdentifier,
  quotePostgresStringLiteral,
} from './postgres-identifier-quoting.ts'
import { buildProjectRoleConnectionString } from './project-connection-string.ts'
import { readProjectDatabasePresence } from './project-database-presence.ts'

/**
 * Creates a project database plus its same-named login role and returns the only copy of the
 * generated password; contract failure modes come back as values instead of being thrown.
 */
export const createProjectDatabase: CreateProjectDatabase = async ({
  adminDatabaseUrl,
  projectDatabaseName,
}) => {
  const projectRolePassword = generateProjectRolePassword()
  const quotedName = quotePostgresIdentifier(projectDatabaseName)

  try {
    return await withPostgresAdminSession<CreateProjectDatabaseResult>(
      adminDatabaseUrl,
      async (adminClient) => {
        const presence = await readProjectDatabasePresence(adminClient, projectDatabaseName)
        if (presence.databaseExists || presence.roleExists) {
          return projectDatabaseAlreadyExistsFailure(projectDatabaseName)
        }

        try {
          await adminClient.query(
            `CREATE ROLE ${quotedName} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${quotePostgresStringLiteral(projectRolePassword)}`,
          )
        } catch (error) {
          return failureForTakenName(error, projectDatabaseName)
        }

        try {
          await adminClient.query(`CREATE DATABASE ${quotedName} OWNER ${quotedName}`)
        } catch (error) {
          await rollbackHalfCreatedProject(adminClient, quotedName, false)
          return failureForTakenName(error, projectDatabaseName)
        }

        try {
          // Without this, PUBLIC keeps its default CONNECT grant and any other project's role could
          // open a session against this database. The owning role keeps its own CONNECT.
          await adminClient.query(`REVOKE CONNECT ON DATABASE ${quotedName} FROM PUBLIC`)
        } catch (error) {
          await rollbackHalfCreatedProject(adminClient, quotedName, true)
          return failureForTakenName(error, projectDatabaseName)
        }

        return {
          kind: 'project-database-created',
          projectDatabaseName,
          connectionString: buildProjectRoleConnectionString({
            adminDatabaseUrl,
            projectDatabaseName,
            projectRolePassword,
          }),
        }
      },
    )
  } catch (error) {
    return postgresErrorToDbFailureOrThrow(error)
  }
}

/** Removes whatever the failed attempt managed to create, so a retry of the same name is not blocked by half of it. */
async function rollbackHalfCreatedProject(
  adminClient: Client,
  quotedName: string,
  databaseWasCreated: boolean,
): Promise<void> {
  if (databaseWasCreated) {
    await runAdminStatementIgnoringErrors(
      adminClient,
      `DROP DATABASE IF EXISTS ${quotedName} WITH (FORCE)`,
    )
  }
  await runAdminStatementIgnoringErrors(adminClient, `DROP ROLE IF EXISTS ${quotedName}`)
}

/** Reads a duplicate-name error as the name being taken; every other error falls back to the shared mapping. */
function failureForTakenName(error: unknown, projectDatabaseName: ProjectDatabaseName): DbFailure {
  if (isPostgresDuplicateNameFailure(error)) {
    return projectDatabaseAlreadyExistsFailure(projectDatabaseName)
  }
  return postgresErrorToDbFailureOrThrow(error)
}
