import { loadHearthkitConfig } from '@hearthkit/config'
import { describe, expect, it } from 'vitest'
import { expectResultKind } from '../test-fixtures/db-result-expectations.ts'
import { loadHearthkitDbEntry } from '../test-fixtures/hearthkit-db-entry.ts'

const projectConnectionString = 'postgresql://myapp:s3cret@localhost:5432/myapp'

describe('dbEnvSchemaFragment', () => {
  it('declares only DATABASE_URL and passes a project connection string through config', async () => {
    const { dbEnvSchemaFragment } = await loadHearthkitDbEntry()
    expect(Object.keys(dbEnvSchemaFragment.shape)).toEqual(['DATABASE_URL'])

    const result = loadHearthkitConfig({
      fragments: [dbEnvSchemaFragment],
      env: { DATABASE_URL: projectConnectionString },
    })

    const loaded = expectResultKind(result, 'config-loaded')
    expect(loaded.config.DATABASE_URL).toBe(projectConnectionString)
  })

  it('fails and names DATABASE_URL when it is unset or empty', async () => {
    const { dbEnvSchemaFragment } = await loadHearthkitDbEntry()

    for (const env of [{}, { DATABASE_URL: '' }]) {
      const failure = expectResultKind(
        loadHearthkitConfig({ fragments: [dbEnvSchemaFragment], env }),
        'config-validation-failed',
      )
      expect(failure.message).toContain('DATABASE_URL')
      const issue = failure.issues.find(
        (candidate) => String(candidate.variableName) === 'DATABASE_URL',
      )
      expect(issue?.kind).toBe('env-variable-missing')
    }
  })

  it('rejects a URL that is not a postgres connection string', async () => {
    const { dbEnvSchemaFragment } = await loadHearthkitDbEntry()

    const failure = expectResultKind(
      loadHearthkitConfig({
        fragments: [dbEnvSchemaFragment],
        env: { DATABASE_URL: 'https://example.com/myapp' },
      }),
      'config-validation-failed',
    )
    expect(failure.message).toContain('DATABASE_URL')
    expect(failure.issues).toHaveLength(1)
  })
})
