import {
  postgresConnectionStringSchema,
  type PostgresConnectionString,
  type ProjectDatabaseName,
} from './db-contract.ts'

/** Same server, same credentials, different database; used to point a tool at one project database. */
export function connectionStringForProjectDatabase(
  connectionString: PostgresConnectionString,
  projectDatabaseName: ProjectDatabaseName,
): PostgresConnectionString {
  const url = new URL(connectionString)
  url.pathname = `/${projectDatabaseName}`
  return postgresConnectionStringSchema.parse(url.toString())
}

/**
 * The one connection string createProjectDatabase hands back: the admin server and port, the
 * project role as user, its generated password, and the project database.
 */
export function buildProjectRoleConnectionString(options: {
  adminDatabaseUrl: PostgresConnectionString
  projectDatabaseName: ProjectDatabaseName
  projectRolePassword: string
}): PostgresConnectionString {
  const url = new URL(options.adminDatabaseUrl)
  url.username = options.projectDatabaseName
  url.password = options.projectRolePassword
  url.pathname = `/${options.projectDatabaseName}`
  return postgresConnectionStringSchema.parse(url.toString())
}
