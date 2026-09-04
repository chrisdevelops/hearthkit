import { afterAll, describe, expect, it } from 'vitest'
import {
  expectAuthFailure,
  expectContractStringExport,
  expectResultKind,
} from '../test-fixtures/auth-gate-expectations.ts'
import { defineGateFileContext } from '../test-fixtures/auth-gate-file-context.ts'
import {
  createVerifiedGateAuthDatabase,
  readGateAuthTableRows,
  type GateAuthDatabase,
} from '../test-fixtures/auth-gate-postgres-database.ts'
import {
  gateAuthPassword,
  gateAuthRuntimeConfig,
  gateAuthSmtpTransportConfig,
  reserveDeadLoopbackPort,
  uniqueGateAuthEmail,
  uniqueGateAuthUserName,
  uniqueGateOrganizationName,
  uniqueGateOrganizationSlug,
} from '../test-fixtures/auth-gate-values.ts'
import {
  loadHearthkitAuthEntry,
  type HearthkitAuthEntry,
} from '../test-fixtures/hearthkit-auth-entry.ts'
import {
  addAuthOrganizationMemberResultSchema,
  betterAuthOrganizationAlreadyExistsErrorCode,
  createAuthOrganizationResultSchema,
  type AuthServerInstance,
} from './auth-contract.ts'

type OrganizationGateFile = {
  authEntry: HearthkitAuthEntry
  gateDatabase: GateAuthDatabase
  organizationsEnabledInstance: AuthServerInstance
  userScopedInstance: AuthServerInstance
  signUpGateUser: (purpose: string) => Promise<string>
}

const gateFile = defineGateFileContext<OrganizationGateFile>(async () => {
  const authEntry = await loadHearthkitAuthEntry()
  const deadSmtpPortNumber = await reserveDeadLoopbackPort()
  const gateDatabase = await createVerifiedGateAuthDatabase('org', authEntry)

  const buildInstance = (organizationsEnabled: boolean) =>
    expectResultKind(
      authEntry.createAuthServerInstance({
        authRuntimeConfig: gateAuthRuntimeConfig(),
        drizzleClient: gateDatabase.drizzleClient,
        emailTransportConfig: gateAuthSmtpTransportConfig(deadSmtpPortNumber),
        organizationsEnabled,
      }),
      'auth-server-instance-created',
    ).authServerInstance

  const organizationsEnabledInstance = buildInstance(true)
  // The same database and the same tables: the organization tables exist in every project whatever
  // the flag is, so this instance differs from the one above only in which endpoints it carries.
  const userScopedInstance = buildInstance(false)

  return {
    authEntry,
    gateDatabase,
    organizationsEnabledInstance,
    userScopedInstance,
    signUpGateUser: async (purpose: string) =>
      String(
        expectResultKind(
          await authEntry.signUpWithPassword({
            authServerInstance: organizationsEnabledInstance,
            email: uniqueGateAuthEmail(purpose),
            password: gateAuthPassword,
            name: uniqueGateAuthUserName(purpose),
          }),
          'auth-signed-up',
        ).authUser.id,
      ),
  }
})

afterAll(async () => {
  await gateFile.releaseIfCreated(({ gateDatabase }) => gateDatabase.removeGateAuthDatabase())
})

describe('createAuthOrganization', () => {
  it('creates the organization and leaves the named user holding an owner membership', async () => {
    const { authEntry, gateDatabase, organizationsEnabledInstance, signUpGateUser } =
      await gateFile.read()
    const ownerAuthUserId = await signUpGateUser('owner')
    const organizationName = uniqueGateOrganizationName('create')
    const organizationSlug = uniqueGateOrganizationSlug('create')

    // The server-side provisioning path: it takes no session headers, which is what plan 4.7's gate
    // needs. An app's own "create organization" button goes through the route handler instead.
    const result = await authEntry.createAuthOrganization({
      authServerInstance: organizationsEnabledInstance,
      organizationName,
      organizationSlug,
      ownerAuthUserId,
    })
    createAuthOrganizationResultSchema.parse(result)
    const created = expectResultKind(result, 'auth-organization-created')

    expect(String(created.organizationName)).toBe(organizationName)
    expect(String(created.organizationSlug)).toBe(organizationSlug)
    expect(String(created.ownerAuthUserId)).toBe(ownerAuthUserId)
    expect(String(created.authOrganizationId).length).toBeGreaterThan(0)

    const ownerMemberships = (
      await readGateAuthTableRows(
        gateDatabase.drizzleClient,
        authEntry.hearthkitAuthDrizzleSchema.member,
      )
    ).filter(
      (row) =>
        row.organizationId === String(created.authOrganizationId) && row.userId === ownerAuthUserId,
    )
    expect(ownerMemberships).toHaveLength(1)
    expect(ownerMemberships[0]?.role).toBe('owner')
  })

  it('reports auth-request-failed carrying Better Auth own error code when the slug is already taken', async () => {
    const { authEntry, organizationsEnabledInstance, signUpGateUser } = await gateFile.read()
    const ownerAuthUserId = await signUpGateUser('slug')
    const organizationSlug = uniqueGateOrganizationSlug('taken')
    expectResultKind(
      await authEntry.createAuthOrganization({
        authServerInstance: organizationsEnabledInstance,
        organizationName: uniqueGateOrganizationName('taken'),
        organizationSlug,
        ownerAuthUserId,
      }),
      'auth-organization-created',
    )

    const result = await authEntry.createAuthOrganization({
      authServerInstance: organizationsEnabledInstance,
      organizationName: uniqueGateOrganizationName('taken-again'),
      organizationSlug,
      ownerAuthUserId,
    })
    createAuthOrganizationResultSchema.parse(result)
    // A slug collision is a caller error, not an unavailable database: it and every other code
    // outside the four-code allowlist stay here, where authErrorCode keeps this from being a dead end.
    const failure = expectAuthFailure(result, 'auth-request-failed')
    // Asserted through the exported symbol, never a hand-typed literal, because the organization
    // plugin's $ERROR_CODES carries ORGANIZATION_SLUG_ALREADY_TAKEN one line away from the code this
    // endpoint actually throws. Reading the library confirms the wrong answer, so the gate and the
    // implementation have to share one spelling. Measured at better-auth@1.7.2: APIError, statusCode
    // 400, error.body?.code ORGANIZATION_ALREADY_EXISTS, message `Organization already exists`.
    expect(failure.authErrorCode).toBe(
      expectContractStringExport(
        betterAuthOrganizationAlreadyExistsErrorCode,
        'betterAuthOrganizationAlreadyExistsErrorCode',
      ),
    )
    // No constant for this one: 400 is measured here and nowhere else in the contract.
    expect(failure.authErrorStatus).toBe(400)
    expect(failure.authFailureDetail.length).toBeGreaterThan(0)
  })

  it('rejects an organization name, slug, owner id and organization id the contract refuses, naming the field', async () => {
    const { authEntry, organizationsEnabledInstance, signUpGateUser } = await gateFile.read()
    const ownerAuthUserId = await signUpGateUser('invalid')

    const slugFailure = expectAuthFailure(
      await authEntry.createAuthOrganization({
        authServerInstance: organizationsEnabledInstance,
        organizationName: uniqueGateOrganizationName('invalid'),
        // Slugs are lowercase kebab-case, the same shape as a hearthkit project name.
        organizationSlug: 'Gate Org With Spaces',
        ownerAuthUserId,
      }),
      'auth-input-invalid',
    )
    expect(slugFailure.invalidFieldName).toBe('organization-slug')

    const nameFailure = expectAuthFailure(
      await authEntry.createAuthOrganization({
        authServerInstance: organizationsEnabledInstance,
        organizationName: '',
        organizationSlug: uniqueGateOrganizationSlug('invalid'),
        ownerAuthUserId,
      }),
      'auth-input-invalid',
    )
    expect(nameFailure.invalidFieldName).toBe('organization-name')

    const ownerFailure = expectAuthFailure(
      await authEntry.createAuthOrganization({
        authServerInstance: organizationsEnabledInstance,
        organizationName: uniqueGateOrganizationName('invalid'),
        organizationSlug: uniqueGateOrganizationSlug('invalid'),
        ownerAuthUserId: '',
      }),
      'auth-input-invalid',
    )
    expect(ownerFailure.invalidFieldName).toBe('user-id')

    // The same rule on the other organization call, which takes the id of an organization that
    // already exists rather than a name and a slug.
    const organizationIdFailure = expectAuthFailure(
      await authEntry.addAuthOrganizationMember({
        authServerInstance: organizationsEnabledInstance,
        authOrganizationId: '',
        authUserId: ownerAuthUserId,
        memberRole: 'member',
      }),
      'auth-input-invalid',
    )
    expect(organizationIdFailure.invalidFieldName).toBe('organization-id')
  })
})

describe('addAuthOrganizationMember', () => {
  it('adds an existing user to the organization with the role it was asked for', async () => {
    const { authEntry, gateDatabase, organizationsEnabledInstance, signUpGateUser } =
      await gateFile.read()
    const ownerAuthUserId = await signUpGateUser('member-owner')
    const created = expectResultKind(
      await authEntry.createAuthOrganization({
        authServerInstance: organizationsEnabledInstance,
        organizationName: uniqueGateOrganizationName('member'),
        organizationSlug: uniqueGateOrganizationSlug('member'),
        ownerAuthUserId,
      }),
      'auth-organization-created',
    )
    // The user must already exist; this call invites nobody.
    const authUserId = await signUpGateUser('member-added')

    const result = await authEntry.addAuthOrganizationMember({
      authServerInstance: organizationsEnabledInstance,
      authOrganizationId: String(created.authOrganizationId),
      authUserId,
      memberRole: 'admin',
    })
    addAuthOrganizationMemberResultSchema.parse(result)
    const added = expectResultKind(result, 'auth-organization-member-added')

    expect(String(added.authOrganizationId)).toBe(String(created.authOrganizationId))
    expect(String(added.authUserId)).toBe(authUserId)
    expect(added.memberRole).toBe('admin')
    expect(String(added.authMemberId).length).toBeGreaterThan(0)

    const memberships = (
      await readGateAuthTableRows(
        gateDatabase.drizzleClient,
        authEntry.hearthkitAuthDrizzleSchema.member,
      )
    ).filter((row) => row.id === String(added.authMemberId))
    expect(memberships).toHaveLength(1)
    expect(memberships[0]?.role).toBe('admin')
  })

  it('reports auth-organizations-disabled from both organization calls when the instance was built with the flag off', async () => {
    const { authEntry, userScopedInstance, signUpGateUser } = await gateFile.read()
    const ownerAuthUserId = await signUpGateUser('disabled')

    // Detected structurally, by the endpoint being absent from the instance's api, not by a flag
    // stored beside it: measured at the pin, typeof api.createOrganization is 'undefined' without the
    // plugin and 'function' with it.
    expectAuthFailure(
      await authEntry.createAuthOrganization({
        authServerInstance: userScopedInstance,
        organizationName: uniqueGateOrganizationName('disabled'),
        organizationSlug: uniqueGateOrganizationSlug('disabled'),
        ownerAuthUserId,
      }),
      'auth-organizations-disabled',
    )

    expectAuthFailure(
      await authEntry.addAuthOrganizationMember({
        authServerInstance: userScopedInstance,
        authOrganizationId: 'gate-organization-id-that-is-never-reached',
        authUserId: ownerAuthUserId,
        memberRole: 'member',
      }),
      'auth-organizations-disabled',
    )
  })
})
