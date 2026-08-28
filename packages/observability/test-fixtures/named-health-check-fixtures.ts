import { Client } from 'pg'
import { healthCheckNameSchema, type NamedHealthCheck } from '../src/observability-contract.ts'

/**
 * The Postgres 17 service in the repo-root docker-compose.yml. Observability must never import
 * @hearthkit/db, so the gate wires database reachability in as a plain pg client, exactly the way
 * the contract says an app does it.
 */
export const gatePostgresUrl =
  process.env.HEARTHKIT_GATE_ADMIN_DATABASE_URL ??
  'postgresql://hearthkit:hearthkit@localhost:5432/hearthkit'

/** A closed localhost port, so the same real check fails without stopping the compose service. */
export const unreachablePostgresUrl = 'postgresql://hearthkit:hearthkit@127.0.0.1:59999/hearthkit'

/** A named health check that opens a real connection, runs select 1 and always closes the client. */
export function createPostgresPingHealthCheck(
  healthCheckName: string,
  connectionString: string,
): NamedHealthCheck {
  return {
    healthCheckName: healthCheckNameSchema.parse(healthCheckName),
    runHealthCheck: async () => {
      const client = new Client({ connectionString, connectionTimeoutMillis: 5_000 })
      client.on('error', () => undefined)
      await client.connect()
      try {
        await client.query('select 1')
      } finally {
        await client.end()
      }
    },
  }
}

/** A named health check that resolves immediately, used to prove one failing check does not hide a passing one. */
export function createAlwaysPassingHealthCheck(healthCheckName: string): NamedHealthCheck {
  return {
    healthCheckName: healthCheckNameSchema.parse(healthCheckName),
    runHealthCheck: async () => undefined,
  }
}

/** A named health check that rejects with the given message, used for the health-check-failed branch. */
export function createRejectingHealthCheck(
  healthCheckName: string,
  failureMessage: string,
): NamedHealthCheck {
  return {
    healthCheckName: healthCheckNameSchema.parse(healthCheckName),
    runHealthCheck: async () => {
      throw new Error(failureMessage)
    },
  }
}

/** A named health check that rejects with a plain string, so the gate can pin the non-Error branch of failureMessage. */
export function createStringRejectingHealthCheck(
  healthCheckName: string,
  thrownString: string,
): NamedHealthCheck {
  return {
    healthCheckName: healthCheckNameSchema.parse(healthCheckName),
    // Throwing a non-Error on purpose: the contract defines String(thrown) as the fallback.
    runHealthCheck: async () => {
      throw thrownString
    },
  }
}

/** A named health check that never settles, used to prove healthCheckTimeoutMs bounds each check. */
export function createNeverSettlingHealthCheck(healthCheckName: string): NamedHealthCheck {
  return {
    healthCheckName: healthCheckNameSchema.parse(healthCheckName),
    runHealthCheck: () => new Promise<void>(() => undefined),
  }
}
