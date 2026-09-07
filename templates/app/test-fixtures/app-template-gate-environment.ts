import { createServer } from 'node:net'

/**
 * A complete environment for the SUPERSET template, and a port nothing listens on.
 *
 * With no optional package selected the template requires no variable at all, which is why the Phase
 * 4 gates could boot it with `{}`. Every one of the four optional packages contributes at least one
 * required variable, so the superset cannot boot on an empty environment and every gate that reaches
 * `requireAppRuntimeConfig`, a section route handler or the health registry has to hand it a full
 * set. Each value below was parsed through its owning package's own envSchemaFragment before it was
 * written here, so a gate that fails is failing on the template rather than on a malformed literal.
 *
 * Nothing here imports src/ or any @hearthkit package: the optional packages are not installed in
 * templates/app until the implementor declares them, and a static import of one would fail the whole
 * gate file at collection instead of failing each gate by name.
 */

/** Every superset variable with a value its owner accepts; GLITCHTIP_DSN stays unset because it is optional everywhere. */
const gateSupersetEnvValuesByName: Readonly<Record<string, string>> = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'error',
  STORAGE_ENDPOINT: 'http://127.0.0.1:9000',
  STORAGE_BUCKET: 'hearthkit-app-template-gate',
  STORAGE_REGION: 'auto',
  STORAGE_ACCESS_KEY_ID: 'hearthkit',
  STORAGE_SECRET_ACCESS_KEY: 'hearthkit',
  EMAIL_TRANSPORT: 'smtp',
  EMAIL_FROM: 'hearthkit app template <no-reply@hearthkit.test>',
  EMAIL_SMTP_HOST: '127.0.0.1',
  EMAIL_SMTP_PORT: '1025',
  EMAIL_SMTP_USER: 'hearthkit',
  EMAIL_SMTP_PASSWORD: 'hearthkit',
  EMAIL_RESEND_API_KEY: 're_gate_key_that_no_resend_account_ever_issued',
  EMAIL_RESEND_BASE_URL: 'http://127.0.0.1:8099',
  DATABASE_URL: 'postgres://hearthkit:hearthkit@127.0.0.1:5432/hearthkit',
  AUTH_SECRET: 'gate-auth-secret-that-is-long-enough-for-the-auth-fragment',
  AUTH_BASE_URL: 'http://127.0.0.1:3000',
  GOOGLE_CLIENT_ID: 'gate-google-client-id',
  GOOGLE_CLIENT_SECRET: 'gate-google-client-secret',
  GITHUB_CLIENT_ID: 'gate-github-client-id',
  GITHUB_CLIENT_SECRET: 'gate-github-client-secret',
  STRIPE_SECRET_KEY: 'gate-stripe-secret-key-that-must-never-be-echoed',
  STRIPE_WEBHOOK_SECRET: 'gate-stripe-webhook-secret-that-must-never-be-echoed',
}

/**
 * The superset environment, with anything the caller overrides applied.
 *
 * `supersetEnvVariableNames` is the contract's own list, passed in and checked rather than trusted:
 * a variable added to the contract and not to this fixture would otherwise turn every gate here into
 * a boot failure whose message names a variable nobody thought was missing.
 */
export function gateSupersetEnv(options: {
  supersetEnvVariableNames: readonly string[]
  optionalEnvVariableNames: readonly string[]
  overrides?: Readonly<Record<string, string>>
}): Record<string, string> {
  const undocumentedVariableNames = options.optionalEnvVariableNames.filter(
    (variableName) => gateSupersetEnvValuesByName[variableName] === undefined,
  )
  if (undocumentedVariableNames.length > 0) {
    throw new Error(
      `gate has no superset value for ${undocumentedVariableNames.join(', ')}; add one to test-fixtures/app-template-gate-environment.ts before the contract can require it`,
    )
  }

  const supersetEnv: Record<string, string> = {}
  for (const variableName of options.supersetEnvVariableNames) {
    const value = gateSupersetEnvValuesByName[variableName]
    if (value !== undefined) {
      supersetEnv[variableName] = value
    }
  }
  return { ...supersetEnv, ...options.overrides }
}

/**
 * A loopback port nothing is listening on, taken by binding port 0 and releasing it.
 *
 * Two gates need one: the health registry's `database` check pointed at a closed port is the only
 * producer of app-health-dependency-unavailable, and the email section pointed at a closed SMTP port
 * is the cheap producer of app-section-route-failed. Both are deterministic and need no service,
 * which is what keeps them in the fast tier.
 */
export async function reserveDeadLoopbackPort(): Promise<number> {
  const probeServer = createServer()
  await new Promise<void>((resolve, reject) => {
    probeServer.once('error', reject)
    probeServer.listen(0, '127.0.0.1', () => {
      probeServer.removeListener('error', reject)
      resolve()
    })
  })
  const address = probeServer.address()
  if (address === null || typeof address === 'string') {
    await new Promise<void>((resolve) => probeServer.close(() => resolve()))
    throw new Error('gate expected the reserved dead port server to be listening on a TCP port')
  }
  const deadPortNumber = address.port
  await new Promise<void>((resolve) => probeServer.close(() => resolve()))
  return deadPortNumber
}
