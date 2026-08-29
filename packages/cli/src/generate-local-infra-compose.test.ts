import { describe, expect, it } from 'vitest'
import { loadHearthkitCliBucketExports } from '../test-fixtures/hearthkit-cli-bucket-exports.ts'
import { loadHearthkitCliEntry } from '../test-fixtures/hearthkit-cli-entry.ts'
import {
  generateLocalInfraComposeOptionsSchema,
  hearthkitProjectNameSchema,
  localInfraServiceImageByName,
  localInfraServiceNameSchema,
} from './cli-contract.ts'

// The function is pure, so a fixed project name is safe: nothing it writes touches the filesystem
// or the docker daemon, and two gate runs cannot collide.
const hearthkitProjectName = 'hearthkit-gate-compose'

/** The emitted lines of one service: its key line plus every line indented deeper than it, so a gate can ask what one service does and does not carry. */
function generatedServiceBlock(composeFileContent: string, serviceName: string): string {
  const lines = composeFileContent.split('\n')
  const headerIndex = lines.indexOf(`  ${serviceName}:`)
  if (headerIndex === -1) {
    throw new Error(`gate expected the generated compose file to declare a ${serviceName} service`)
  }
  const blockLines = [lines[headerIndex] as string]
  for (const line of lines.slice(headerIndex + 1)) {
    if (!line.startsWith('    ')) {
      break
    }
    blockLines.push(line)
  }
  return blockLines.join('\n')
}

/** Where a service key sits in the emitted text, so a gate can pin the fixed order the contract calls deterministic. */
function generatedServiceKeyPosition(composeFileContent: string, serviceName: string): number {
  const keyPosition = composeFileContent.indexOf(`\n  ${serviceName}:\n`)
  if (keyPosition === -1) {
    throw new Error(`gate expected the generated compose file to declare a ${serviceName} service`)
  }
  return keyPosition
}

/** Generates the compose file for one set of services, going through the options schema the contract publishes. */
async function generateGateComposeFileContent(infraServices: readonly string[]): Promise<string> {
  const { generateLocalInfraCompose } = await loadHearthkitCliEntry()
  return generateLocalInfraCompose(
    generateLocalInfraComposeOptionsSchema.parse({ hearthkitProjectName, infraServices }),
  )
}

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

  it('emits the bucket init container immediately after minio and before mailpit, still byte-identical for identical input', async () => {
    const { localStorageBucketInitServiceName } = await loadHearthkitCliBucketExports()
    const composeFileContent = await generateGateComposeFileContent([
      ...localInfraServiceNameSchema.options,
    ])

    expect(await generateGateComposeFileContent([...localInfraServiceNameSchema.options])).toBe(
      composeFileContent,
    )
    // Fixed order: minio, then the container that creates its bucket, then mailpit. The contract
    // calls the function deterministic, so the position is part of the output, not an accident.
    expect(generatedServiceKeyPosition(composeFileContent, 'minio')).toBeLessThan(
      generatedServiceKeyPosition(composeFileContent, localStorageBucketInitServiceName),
    )
    expect(
      generatedServiceKeyPosition(composeFileContent, localStorageBucketInitServiceName),
    ).toBeLessThan(generatedServiceKeyPosition(composeFileContent, 'mailpit'))
    expect(composeFileContent).toContain(
      `${hearthkitProjectName}-${localStorageBucketInitServiceName}`,
    )
    // It is a container the generator adds, never a service a project selects, so it is neither a
    // LocalInfraServiceName nor an accepted infraServices value.
    expect(localInfraServiceNameSchema.options as readonly string[]).not.toContain(
      localStorageBucketInitServiceName,
    )
    expect(
      generateLocalInfraComposeOptionsSchema.safeParse({
        hearthkitProjectName,
        infraServices: [localStorageBucketInitServiceName],
      }).success,
    ).toBe(false)
  })

  it('leaves the bucket init container out entirely when minio is not one of the selected services', async () => {
    const {
      deriveLocalStorageBucketName,
      localStorageBucketInitServiceName,
      localStorageBucketInitImage,
    } = await loadHearthkitCliBucketExports()
    const composeFileContent = await generateGateComposeFileContent(['postgres', 'mailpit'])

    expect(composeFileContent).not.toContain(localStorageBucketInitServiceName)
    expect(composeFileContent).not.toContain(localStorageBucketInitImage)
    expect(composeFileContent).not.toContain(
      deriveLocalStorageBucketName(hearthkitProjectNameSchema.parse(hearthkitProjectName)),
    )
    expect(composeFileContent).not.toContain('mc mb')
  })

  it('gives the bucket init container the pinned mc image, a long-syntax wait for a healthy minio, and no restart, ports, volumes or environment', async () => {
    const { localStorageBucketInitServiceName, localStorageBucketInitImage } =
      await loadHearthkitCliBucketExports()
    const composeFileContent = await generateGateComposeFileContent(['minio'])
    const bucketInitBlock = generatedServiceBlock(
      composeFileContent,
      localStorageBucketInitServiceName,
    )

    // The image comes from its own exported pin, deliberately not from the map of selectable
    // service images, so the two can be bumped in one place each rather than retyped here.
    expect(bucketInitBlock).toContain(localStorageBucketInitImage)
    expect(Object.values(localInfraServiceImageByName) as readonly string[]).not.toContain(
      localStorageBucketInitImage,
    )
    expect(bucketInitBlock).toMatch(
      new RegExp(
        `container_name:\\s*['"]?${hearthkitProjectName}-${localStorageBucketInitServiceName}['"]?\\s*$`,
        'm',
      ),
    )
    // Long syntax, so the container waits for the healthcheck rather than racing the server.
    expect(bucketInitBlock).toMatch(/depends_on:\s*\n\s+minio:\s*\n\s+condition:\s*service_healthy/)
    // No restart key, so compose's default no applies; and none of the three blocks the
    // long-running services carry, because this container publishes and stores nothing. Each is
    // checked as an absent key rather than an absent word, so the explanatory comment the contract
    // asks for above this service cannot fail the gate by mentioning one of them.
    expect(bucketInitBlock).not.toMatch(/^\s+restart:/m)
    expect(bucketInitBlock).not.toMatch(/^\s+ports:/m)
    expect(bucketInitBlock).not.toMatch(/^\s+volumes:/m)
    expect(bucketInitBlock).not.toMatch(/^\s+environment:/m)
  })

  it('ends the bucket init entrypoint with tail -f /dev/null so the container never exits under docker compose up --wait', async () => {
    const { deriveLocalStorageBucketName, localStorageBucketInitServiceName } =
      await loadHearthkitCliBucketExports()
    const composeFileContent = await generateGateComposeFileContent(['minio'])
    const bucketInitBlock = generatedServiceBlock(
      composeFileContent,
      localStorageBucketInitServiceName,
    )
    // The bucket name is taken from the exported derivation rather than retyped, so the name in the
    // compose file and the name @hearthkit/create writes to STORAGE_BUCKET cannot drift apart.
    const localStorageBucketName = deriveLocalStorageBucketName(
      hearthkitProjectNameSchema.parse(hearthkitProjectName),
    )
    const bucketInitEntrypointCommand = `mc alias set local http://minio:9000 hearthkit hearthkit && mc mb --ignore-existing local/${localStorageBucketName} && tail -f /dev/null`

    expect(bucketInitBlock).toContain(bucketInitEntrypointCommand)
    const entrypointPosition = bucketInitBlock.indexOf('entrypoint:')
    expect(entrypointPosition).toBeGreaterThanOrEqual(0)
    const entrypointArgumentText = bucketInitBlock.slice(
      entrypointPosition,
      bucketInitBlock.indexOf(bucketInitEntrypointCommand),
    )
    expect(entrypointArgumentText).toMatch(/['"]sh['"]/)
    expect(entrypointArgumentText).toMatch(/['"]-c['"]/)

    // tail -f /dev/null is the whole fix and is pinned on its own. docker compose up --wait exits 1
    // when any service it started has exited, whatever the exit code, and dev infra up always
    // passes --wait; an init container that did its work and exited 0 would make every dev infra
    // up report infra-compose-failed with the bucket created perfectly. Nothing may follow it in
    // the chain, or the container stops being the last thing running.
    const tailStepPosition = bucketInitBlock.indexOf('tail -f /dev/null')
    expect(tailStepPosition).toBeGreaterThan(bucketInitBlock.indexOf('mc mb --ignore-existing'))
    expect(bucketInitBlock.slice(tailStepPosition)).not.toContain('&&')
    // --ignore-existing is what makes a second dev infra up a no-op instead of a failure.
    expect(bucketInitBlock).toContain('--ignore-existing')
  })

  it('health checks the minio service with mc ready local so the bucket init container has a healthy state to wait for', async () => {
    const composeFileContent = await generateGateComposeFileContent(['minio'])
    const minioBlock = generatedServiceBlock(composeFileContent, 'minio')

    expect(minioBlock).toContain('healthcheck:')
    expect(minioBlock).toMatch(
      /test:\s*\[\s*['"]CMD['"],\s*['"]mc['"],\s*['"]ready['"],\s*['"]local['"]\s*\]/,
    )
    // Interval and retry count match the postgres service already in the file.
    expect(minioBlock).toMatch(/interval:\s*5s/)
    expect(minioBlock).toMatch(/timeout:\s*5s/)
    expect(minioBlock).toMatch(/retries:\s*20/)
  })
})
