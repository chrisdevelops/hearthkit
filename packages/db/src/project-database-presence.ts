import type { Client } from 'pg'
import type { DbFailure, PostgresConnectionString, ProjectDatabaseName } from './db-contract.ts'
import { projectDatabaseNotFoundFailure } from './db-failure-results.ts'
import { withPostgresAdminSession } from './postgres-admin-session.ts'
import { postgresErrorToDbFailureOrThrow } from './postgres-error-to-db-failure.ts'

/** Whether the name is taken on the server, read as one query because one name spells both the database and its role. */
export type ProjectDatabasePresence = {
  databaseExists: boolean
  roleExists: boolean
}

/** Reads pg_database and pg_roles for one name; both catalogues are readable by any connected role. */
export async function readProjectDatabasePresence(
  adminClient: Client,
  projectDatabaseName: ProjectDatabaseName,
): Promise<ProjectDatabasePresence> {
  const result = await adminClient.query<{ database_exists: boolean; role_exists: boolean }>(
    `select
       exists(select 1 from pg_database where datname = $1) as database_exists,
       exists(select 1 from pg_roles where rolname = $1) as role_exists`,
    [projectDatabaseName],
  )
  const row = result.rows[0]
  return {
    databaseExists: row?.database_exists === true,
    roleExists: row?.role_exists === true,
  }
}

/**
 * Preflight for backup and restore: returns the failure to hand back when the server cannot be
 * reached or the database is not there, and undefined when it is safe to spawn a client binary.
 */
export async function findMissingProjectDatabaseFailure(
  adminDatabaseUrl: PostgresConnectionString,
  projectDatabaseName: ProjectDatabaseName,
): Promise<DbFailure | undefined> {
  try {
    return await withPostgresAdminSession<DbFailure | undefined>(
      adminDatabaseUrl,
      async (adminClient) => {
        const presence = await readProjectDatabasePresence(adminClient, projectDatabaseName)
        return presence.databaseExists
          ? undefined
          : projectDatabaseNotFoundFailure(projectDatabaseName)
      },
    )
  } catch (error) {
    return postgresErrorToDbFailureOrThrow(error)
  }
}
