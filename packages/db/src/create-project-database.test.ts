import { afterAll, describe, expect, it } from 'vitest'
import { expectDbFailure, expectResultKind } from '../test-fixtures/db-result-expectations.js'
import { loadHearthkitDbEntry } from '../test-fixtures/hearthkit-db-entry.js'
import {
  connectionStringForDatabase,
  expectConnectionRefused,
  gateAdminDatabaseUrl,
  gateDatabaseExists,
  gateRoleExists,
  queryRowsAs,
  removeGateDatabase,
  runAdminStatement,
  uniqueGateDatabaseName,
  unreachableDatabaseUrl,
  withPostgresClient,
} from '../test-fixtures/postgres-gate-server.js'
import {
  createProjectDatabaseResultSchema,
  dbAlreadyExistsErrorPrefix,
  dbPrivilegeErrorPrefix,
  dbUnreachableErrorPrefix,
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

describe('createProjectDatabase', () => {
  it('creates the database and a same-named scoped role and returns a connection string that works', async () => {
    const { createProjectDatabase } = await loadHearthkitDbEntry()
    const projectDatabaseName = gateDatabaseName('create')

    const result = await createProjectDatabase({
      adminDatabaseUrl: gateAdminDatabaseUrl,
      projectDatabaseName,
    })

    createProjectDatabaseResultSchema.parse(result)
    const created = expectResultKind(result, 'project-database-created')
    expect(created.projectDatabaseName).toBe(projectDatabaseName)
    expect(await gateDatabaseExists(projectDatabaseName)).toBe(true)
    expect(await gateRoleExists(projectDatabaseName)).toBe(true)

    // The one returned string is enough to work as the project: same name for database and role.
    await withPostgresClient(created.connectionString, async (client) => {
      const identity = await client.query(
        'select current_user as connected_role, current_database() as connected_database',
      )
      expect(identity.rows).toEqual([
        { connected_role: projectDatabaseName, connected_database: projectDatabaseName },
      ])
      await client.query('create table gate_owned (id integer primary key)')
      await client.query('insert into gate_owned (id) values (7)')
      const owned = await client.query('select id from gate_owned')
      expect(owned.rows).toEqual([{ id: 7 }])
    })
  })

  it('scopes the role to its own database so it cannot connect to another project database', async () => {
    const { createProjectDatabase } = await loadHearthkitDbEntry()
    const firstName = gateDatabaseName('iso_one')
    const secondName = gateDatabaseName('iso_two')

    const first = expectResultKind(
      await createProjectDatabase({
        adminDatabaseUrl: gateAdminDatabaseUrl,
        projectDatabaseName: firstName,
      }),
      'project-database-created',
    )
    const second = expectResultKind(
      await createProjectDatabase({
        adminDatabaseUrl: gateAdminDatabaseUrl,
        projectDatabaseName: secondName,
      }),
      'project-database-created',
    )

    // First project's credentials, second project's database: PUBLIC has no CONNECT privilege.
    const crossProjectUrl = connectionStringForDatabase(first.connectionString, secondName)
    const refusal = await expectConnectionRefused(crossProjectUrl)
    expect(refusal).toContain(secondName)

    // Each role still reaches its own database.
    expect(await queryRowsAs(second.connectionString, 'select current_database() as name')).toEqual(
      [{ name: secondName }],
    )
  })

  it('returns project-database-already-exists when either the database or the role is taken', async () => {
    const { createProjectDatabase } = await loadHearthkitDbEntry()
    const takenName = gateDatabaseName('exists')

    expectResultKind(
      await createProjectDatabase({
        adminDatabaseUrl: gateAdminDatabaseUrl,
        projectDatabaseName: takenName,
      }),
      'project-database-created',
    )

    const secondAttempt = await createProjectDatabase({
      adminDatabaseUrl: gateAdminDatabaseUrl,
      projectDatabaseName: takenName,
    })
    createProjectDatabaseResultSchema.parse(secondAttempt)
    const failure = expectDbFailure(secondAttempt, 'project-database-already-exists')
    expect(failure.projectDatabaseName).toBe(takenName)
    expect(failure.message.startsWith(dbAlreadyExistsErrorPrefix)).toBe(true)
    expect(failure.message).toContain(takenName)

    // A name with only the role taken is taken too: one name spells both.
    const roleOnlyName = gateDatabaseName('role_only')
    await runAdminStatement(`CREATE ROLE "${roleOnlyName}" LOGIN PASSWORD 'gate-placeholder'`)
    const roleOnlyFailure = expectDbFailure(
      await createProjectDatabase({
        adminDatabaseUrl: gateAdminDatabaseUrl,
        projectDatabaseName: roleOnlyName,
      }),
      'project-database-already-exists',
    )
    expect(roleOnlyFailure.projectDatabaseName).toBe(roleOnlyName)
    expect(await gateDatabaseExists(roleOnlyName)).toBe(false)
  })

  it('returns database-server-unreachable when the admin connection points at a closed port', async () => {
    const { createProjectDatabase } = await loadHearthkitDbEntry()

    const result = await createProjectDatabase({
      adminDatabaseUrl: unreachableDatabaseUrl,
      projectDatabaseName: gateDatabaseName('unreachable'),
    })

    createProjectDatabaseResultSchema.parse(result)
    const failure = expectDbFailure(result, 'database-server-unreachable')
    expect(failure.message.startsWith(dbUnreachableErrorPrefix)).toBe(true)
  })

  it('returns database-privilege-denied when the admin role may not create databases', async () => {
    const { createProjectDatabase } = await loadHearthkitDbEntry()
    const scopedOwnerName = gateDatabaseName('priv_owner')

    // A project role is exactly a role without CREATEDB and CREATEROLE, so it stands in for a
    // wrongly provisioned admin connection.
    const scopedOwner = expectResultKind(
      await createProjectDatabase({
        adminDatabaseUrl: gateAdminDatabaseUrl,
        projectDatabaseName: scopedOwnerName,
      }),
      'project-database-created',
    )

    const deniedName = gateDatabaseName('priv_denied')
    const result = await createProjectDatabase({
      adminDatabaseUrl: scopedOwner.connectionString,
      projectDatabaseName: deniedName,
    })

    createProjectDatabaseResultSchema.parse(result)
    const failure = expectDbFailure(result, 'database-privilege-denied')
    expect(failure.message.startsWith(dbPrivilegeErrorPrefix)).toBe(true)
    expect(await gateDatabaseExists(deniedName)).toBe(false)
  })
})
