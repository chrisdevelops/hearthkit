import { afterAll, describe, expect, it } from 'vitest'
import { expectDbFailure, expectResultKind } from '../test-fixtures/db-result-expectations.js'
import { loadHearthkitDbEntry } from '../test-fixtures/hearthkit-db-entry.js'
import {
  expectConnectionRefused,
  gateAdminDatabaseUrl,
  gateDatabaseExists,
  gateRoleExists,
  openPostgresClient,
  removeGateDatabase,
  uniqueGateDatabaseName,
  unreachableDatabaseUrl,
} from '../test-fixtures/postgres-gate-server.js'
import {
  dbNotFoundErrorPrefix,
  dbUnreachableErrorPrefix,
  dropProjectDatabaseResultSchema,
  type ProjectDatabaseName,
} from './db-contract.js'

const namesToRemove: ProjectDatabaseName[] = []

/** A fresh name that afterAll will clean up whether or not the gate managed to create it. */
function gateDatabaseName(purpose: string): ProjectDatabaseName {
  const name = uniqueGateDatabaseName(purpose)
  namesToRemove.push(name)
  return name
}

afterAll(async () => {
  for (const name of namesToRemove) {
    await removeGateDatabase(name)
  }
})

describe('dropProjectDatabase', () => {
  it('drops the database and its role while a client is still connected', async () => {
    const { createProjectDatabase, dropProjectDatabase } = await loadHearthkitDbEntry()
    const projectDatabaseName = gateDatabaseName('drop')

    const created = expectResultKind(
      await createProjectDatabase({
        adminDatabaseUrl: gateAdminDatabaseUrl,
        projectDatabaseName,
      }),
      'project-database-created',
    )

    // Hold an open session: the drop has to terminate it rather than fail.
    const liveClient = await openPostgresClient(created.connectionString)
    await liveClient.query('select 1')

    const result = await dropProjectDatabase({
      adminDatabaseUrl: gateAdminDatabaseUrl,
      projectDatabaseName,
    })

    dropProjectDatabaseResultSchema.parse(result)
    const dropped = expectResultKind(result, 'project-database-dropped')
    expect(dropped.projectDatabaseName).toBe(projectDatabaseName)
    expect(await gateDatabaseExists(projectDatabaseName)).toBe(false)
    expect(await gateRoleExists(projectDatabaseName)).toBe(false)

    // The connection string handed out at creation is now worthless.
    await expectConnectionRefused(created.connectionString)
    await liveClient.end().catch(() => undefined)
  })

  it('returns project-database-not-found for a name that is not on the server', async () => {
    const { dropProjectDatabase } = await loadHearthkitDbEntry()
    const missingName = uniqueGateDatabaseName('drop_missing')

    const result = await dropProjectDatabase({
      adminDatabaseUrl: gateAdminDatabaseUrl,
      projectDatabaseName: missingName,
    })

    dropProjectDatabaseResultSchema.parse(result)
    const failure = expectDbFailure(result, 'project-database-not-found')
    expect(failure.projectDatabaseName).toBe(missingName)
    expect(failure.message.startsWith(dbNotFoundErrorPrefix)).toBe(true)
    expect(failure.message).toContain(missingName)
  })

  it('returns database-server-unreachable when the admin connection points at a closed port', async () => {
    const { dropProjectDatabase } = await loadHearthkitDbEntry()

    const result = await dropProjectDatabase({
      adminDatabaseUrl: unreachableDatabaseUrl,
      projectDatabaseName: uniqueGateDatabaseName('drop_unreachable'),
    })

    dropProjectDatabaseResultSchema.parse(result)
    const failure = expectDbFailure(result, 'database-server-unreachable')
    expect(failure.message.startsWith(dbUnreachableErrorPrefix)).toBe(true)
  })
})
