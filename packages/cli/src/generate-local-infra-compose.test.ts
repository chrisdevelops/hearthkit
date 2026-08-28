import { describe, expect, it } from 'vitest'
import { loadHearthkitCliEntry } from '../test-fixtures/hearthkit-cli-entry.js'
import {
  generateLocalInfraComposeOptionsSchema,
  localInfraServiceImageByName,
  localInfraServiceNameSchema,
} from './cli-contract.js'

// The function is pure, so a fixed project name is safe: nothing it writes touches the filesystem
// or the docker daemon, and two gate runs cannot collide.
const hearthkitProjectName = 'hearthkit-gate-compose'

describe('generateLocalInfraCompose', () => {
  it('returns identical yaml for identical input and pins every image from localInfraServiceImageByName', async () => {
    const { generateLocalInfraCompose } = await loadHearthkitCliEntry()
    const options = generateLocalInfraComposeOptionsSchema.parse({
      hearthkitProjectName,
      infraServices: [...localInfraServiceNameSchema.options],
    })

    const composeFileContent = generateLocalInfraCompose(options)
    expect(generateLocalInfraCompose(options)).toBe(composeFileContent)

    for (const image of Object.values(localInfraServiceImageByName)) {
      expect(composeFileContent).toContain(image)
    }
    for (const serviceName of localInfraServiceNameSchema.options) {
      expect(composeFileContent).toContain(`${hearthkitProjectName}-${serviceName}`)
    }
    // Host ports are fixed per the contract table.
    for (const publishedPort of ['5432:5432', '9000:9000', '9001:9001', '1025:1025', '8025:8025']) {
      expect(composeFileContent).toContain(publishedPort)
    }
    // Postgres and minio keep a named volume; mailpit has none.
    expect(composeFileContent).toContain(`${hearthkitProjectName}-postgres-data`)
    expect(composeFileContent).toContain(`${hearthkitProjectName}-minio-data`)
    expect(composeFileContent).not.toContain(`${hearthkitProjectName}-mailpit-data`)
    // Postgres credentials have to match defaultLocalAdminDatabaseUrl, and the service is health checked.
    expect(composeFileContent).toContain('POSTGRES_USER')
    expect(composeFileContent).toContain('POSTGRES_PASSWORD')
    expect(composeFileContent).toContain('POSTGRES_DB')
    expect(composeFileContent).toContain('pg_isready')
    expect(composeFileContent).toContain('MINIO_ROOT_USER')
    expect(composeFileContent).toContain('MINIO_ROOT_PASSWORD')
  })
})
