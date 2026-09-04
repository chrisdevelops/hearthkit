import { afterAll, describe, expect, it } from 'vitest'
import {
  expectContractNumberExport,
  expectResultKind,
} from '../test-fixtures/auth-gate-expectations.ts'
import { defineGateFileContext } from '../test-fixtures/auth-gate-file-context.ts'
import {
  createGateDrizzleClientForUrl,
  unreachableGateDatabaseUrl,
} from '../test-fixtures/auth-gate-postgres-database.ts'
import {
  startGateAuthRouteHandlerListener,
  type GateAuthRouteHandlerListener,
} from '../test-fixtures/auth-gate-route-handler-listener.ts'
import {
  gateAuthBaseUrl,
  gateAuthRuntimeConfig,
  gateAuthSmtpTransportConfig,
  reserveDeadLoopbackPort,
  uniqueGateOrganizationName,
  uniqueGateOrganizationSlug,
} from '../test-fixtures/auth-gate-values.ts'
import {
  loadHearthkitAuthEntry,
  type HearthkitAuthEntry,
} from '../test-fixtures/hearthkit-auth-entry.ts'
import {
  authBrowserClientSchema,
  organizationRouteAbsentHttpStatus,
  organizationRouteUnauthorizedHttpStatus,
  type AuthServerInstance,
} from './auth-contract.ts'

/**
 * Contacts no service. createAuthBrowserClient cannot fail and reaches nothing until a hook or a call
 * runs, and the network-boundary gate below needs no database either: route resolution and the session
 * check both happen before the adapter is touched, so its server instances are built over a Drizzle
 * client aimed at a closed port.
 *
 * What the organizations flag can and cannot be asserted on, because it decides the shape of this
 * whole file. The flag has NO effect readable off the returned client. Measured at better-auth@1.7.2,
 * the client is a Proxy whose target is a function and it answers every property access: with
 * organizationClient() absent, `typeof client.organization` is still 'function', and so is
 * `typeof client.definitelyNotAPlugin`, a name no plugin has ever defined. `'organization' in client`
 * is false in BOTH modes. So every property check on this value is vacuous — it passes whatever the
 * client is — and a gate built from one would read like coverage while asserting nothing.
 *
 * The flag's observable effect is at the network boundary, which is where the third gate puts it: one
 * client, one organization.create call, routed to a server built with the flag off and then to one
 * built with it on. The 404 alone would be satisfied by a misspelled path, so the pair is what carries
 * the meaning — the 401 from the flag-on server is the same request rejected for want of a session
 * rather than for want of a route, which is what makes the 404 mean "this server has no organization
 * endpoint at all".
 */

type BrowserClientGateFile = {
  authEntry: HearthkitAuthEntry
  listener: GateAuthRouteHandlerListener
  organizationsEnabledInstance: AuthServerInstance
  userScopedInstance: AuthServerInstance
  closeDatabaseClient: () => Promise<void>
}

const gateFile = defineGateFileContext<BrowserClientGateFile>(async () => {
  const authEntry = await loadHearthkitAuthEntry()
  const deadSmtpPortNumber = await reserveDeadLoopbackPort()
  // Aimed at a closed port on purpose. Nothing here queries, and a client that cannot connect proves
  // it: a gate that started needing a database would fail here rather than pass quietly.
  const { drizzleClient, closeDatabaseClient } = createGateDrizzleClientForUrl(
    unreachableGateDatabaseUrl,
    authEntry.hearthkitAuthDrizzleSchema,
  )

  const buildInstance = (organizationsEnabled: boolean) =>
    expectResultKind(
      authEntry.createAuthServerInstance({
        authRuntimeConfig: gateAuthRuntimeConfig(),
        drizzleClient,
        emailTransportConfig: gateAuthSmtpTransportConfig(deadSmtpPortNumber),
        organizationsEnabled,
      }),
      'auth-server-instance-created',
    ).authServerInstance

  // Both instances first and the listener last, so that a build which fails here leaves no open
  // socket behind. afterAll only releases a context that finished building, and a listening server
  // holds the event loop open: getting this order wrong turns a clear failure into a hung run.
  const organizationsEnabledInstance = buildInstance(true)
  const userScopedInstance = buildInstance(false)

  return {
    authEntry,
    listener: await startGateAuthRouteHandlerListener(),
    organizationsEnabledInstance,
    userScopedInstance,
    closeDatabaseClient,
  }
})

afterAll(async () => {
  await gateFile.releaseIfCreated(async ({ listener, closeDatabaseClient }) => {
    await listener.closeGateAuthRouteHandlerListener()
    await closeDatabaseClient()
  })
})

describe('createAuthBrowserClient', () => {
  it('returns a client authBrowserClientSchema accepts, in both modes and with or without a baseUrl', async () => {
    const { authEntry } = await gateFile.read()

    // Omitting baseUrl is the same-origin case, which is every hearthkit project; the option exists
    // only for a split deployment, and the network-boundary gate below is the one that uses it.
    for (const options of [
      { organizationsEnabled: false },
      { organizationsEnabled: true },
      { organizationsEnabled: false, baseUrl: gateAuthBaseUrl },
      { organizationsEnabled: true, baseUrl: gateAuthBaseUrl },
    ]) {
      // The root value is the only thing this schema checks, and it is the only non-vacuous fact
      // available: `typeof value === 'function'`, which a Proxy over a function target reports. It
      // rules out undefined, null, a plain object and a primitive, so an implementation that returned
      // a wrapper object or nothing at all fails here.
      authBrowserClientSchema.parse(authEntry.createAuthBrowserClient(options))
    }
  })

  it('answers every property access with a function, including a name no plugin defines, so no property check tells the two modes apart', async () => {
    const { authEntry } = await gateFile.read()

    const userScopedClient = authEntry.createAuthBrowserClient({ organizationsEnabled: false })
    const organizationsEnabledClient = authEntry.createAuthBrowserClient({
      organizationsEnabled: true,
    })

    for (const client of [userScopedClient, organizationsEnabledClient] as unknown as Record<
      string,
      unknown
    >[]) {
      // The measurement the rest of this file rests on, and the one that fails loudly if a release
      // stops proxying or if somebody wraps the client to make `organization` genuinely absent — which
      // the user considered and rejected, because it stops the returned value being a plain Better
      // Auth client. `definitelyNotAPlugin` is the control: it is answered exactly like the real
      // members, which is what makes a check on any of them assert nothing.
      expect(typeof client.definitelyNotAPlugin).toBe('function')
      expect(typeof client.organization).toBe('function')
      // Neither does the `in` operator, which is the other thing a reader reaches for.
      expect('organization' in client).toBe(false)
    }
  })

  it('gets the route-absent status from a server built with organizations off and the unauthorized control from one built with it on, for the same organization create call', async () => {
    const { authEntry, listener, organizationsEnabledInstance, userScopedInstance } =
      await gateFile.read()
    const absentStatus = expectContractNumberExport(
      organizationRouteAbsentHttpStatus,
      'organizationRouteAbsentHttpStatus',
    )
    const unauthorizedStatus = expectContractNumberExport(
      organizationRouteUnauthorizedHttpStatus,
      'organizationRouteUnauthorizedHttpStatus',
    )

    listener.routeGateRequestsTo(userScopedInstance)
    // ONE client, built in user-scoped mode, used for both halves. That is what makes this the same
    // request twice rather than two requests that only look alike: the flag-off client builds and
    // sends the organization call quite happily, because the Proxy answers `organization.create` in
    // both modes. The property read never fails; the request does.
    const userScopedClient = authEntry.createAuthBrowserClient({
      organizationsEnabled: false,
      baseUrl: listener.baseUrl,
    }) as unknown as {
      organization: {
        create: (body: {
          name: string
          slug: string
        }) => Promise<{ data: unknown; error: { status?: number } | null }>
      }
    }
    // Contacts nothing until a hook or a call runs: the listener is already routed and would have
    // recorded anything the constructor sent.
    expect(listener.recordedGateRequests()).toHaveLength(0)

    const againstUserScopedServer = await userScopedClient.organization.create({
      name: uniqueGateOrganizationName('boundary'),
      slug: uniqueGateOrganizationSlug('boundary'),
    })

    listener.routeGateRequestsTo(organizationsEnabledInstance)
    const againstOrganizationsEnabledServer = await userScopedClient.organization.create({
      name: uniqueGateOrganizationName('boundary-control'),
      slug: uniqueGateOrganizationSlug('boundary-control'),
    })

    // Both requests really crossed the socket and reached a server instance this package built. Without
    // this, a client whose baseUrl was ignored could answer from somewhere else entirely and the two
    // status assertions below would be measuring a stranger.
    const handled = listener.recordedGateRequests()
    expect(handled).toHaveLength(2)
    for (const request of handled) {
      expect(request.method).toBe('POST')
      expect(request.pathname).toBe('/api/auth/organization/create')
    }
    expect(handled[0]?.responseStatus).toBe(absentStatus)
    expect(handled[1]?.responseStatus).toBe(unauthorizedStatus)

    // And the client surfaced each one on its ordinary { data: null, error } arm rather than throwing.
    // Only the status is asserted: the bodies are empty, and statusText is not stable across the way a
    // response is delivered — the same 401 reads 'UNAUTHORIZED' handed straight to a fetch stub and
    // 'Unauthorized' once Node's HTTP server has written it out.
    expect(againstUserScopedServer.data).toBeNull()
    expect(againstUserScopedServer.error?.status).toBe(absentStatus)
    expect(againstOrganizationsEnabledServer.data).toBeNull()
    expect(againstOrganizationsEnabledServer.error?.status).toBe(unauthorizedStatus)
  })
})
