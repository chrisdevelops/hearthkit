import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  gateWidgetsCreateTableSql,
  gateWidgetsSeedSql,
  gateWidgetsTable,
} from '../test-fixtures/gate-widgets-table.ts'
import { loadHearthkitDbEntry } from '../test-fixtures/hearthkit-db-entry.ts'
import {
  createAdminOwnedGateDatabase,
  removeGateDatabase,
  uniqueGateDatabaseName,
  unreachableDatabaseUrl,
  withPostgresClient,
} from '../test-fixtures/postgres-gate-server.ts'
import { drizzleClientHandleSchema, type PostgresConnectionString } from './db-contract.ts'

const gateDatabaseName = uniqueGateDatabaseName('client')
let gateDatabaseUrl: PostgresConnectionString

beforeAll(async () => {
  gateDatabaseUrl = await createAdminOwnedGateDatabase(gateDatabaseName)
  await withPostgresClient(gateDatabaseUrl, async (client) => {
    await client.query(gateWidgetsCreateTableSql)
    await client.query(gateWidgetsSeedSql)
  })
})

afterAll(async () => {
  await removeGateDatabase(gateDatabaseName)
})

describe('createDrizzleClient', () => {
  it('returns a typed client that reads the app schema and a close function that ends the pool', async () => {
    const { createDrizzleClient } = await loadHearthkitDbEntry()

    const handle = createDrizzleClient({
      databaseUrl: gateDatabaseUrl,
      schema: { gateWidgetsTable },
    })
    drizzleClientHandleSchema.parse(handle)

    const widgetRows = await handle.drizzleClient
      .select()
      .from(gateWidgetsTable)
      .orderBy(gateWidgetsTable.id)
    expect(widgetRows).toEqual([
      { id: 1, label: 'first widget' },
      { id: 2, label: 'second widget' },
    ])

    // The schema was handed to Drizzle, not dropped on the floor.
    expect(Object.keys(handle.drizzleClient.query)).toContain('gateWidgetsTable')

    await handle.closeDatabaseClient()

    // The pool is really closed, so a process holding this handle can exit.
    await expect(async () => {
      await handle.drizzleClient.select().from(gateWidgetsTable)
    }).rejects.toThrow()
  })

  it('does not connect until the first query, so an unreachable server fails at query time', async () => {
    const { createDrizzleClient } = await loadHearthkitDbEntry()

    // Creating the client against a closed port must not throw: the contract says it is lazy.
    const handle = createDrizzleClient({
      databaseUrl: unreachableDatabaseUrl,
      schema: { gateWidgetsTable },
    })
    drizzleClientHandleSchema.parse(handle)

    await expect(async () => {
      await handle.drizzleClient.select().from(gateWidgetsTable)
    }).rejects.toThrow()

    await handle.closeDatabaseClient()
  })
})
