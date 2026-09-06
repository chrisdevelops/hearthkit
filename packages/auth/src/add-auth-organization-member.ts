import { z } from 'zod'
import {
  authMemberIdSchema,
  authMemberRoleSchema,
  authOrganizationIdSchema,
  authUserIdSchema,
  type AddAuthOrganizationMemberOptions,
  type AddAuthOrganizationMemberResult,
} from './auth-contract.ts'
import {
  authInputInvalidFailure,
  authOrganizationsDisabledFailure,
  authRequestFailedFailure,
} from './auth-failure-results.ts'
import { readAuthServerApiEndpoint } from './auth-server-api-endpoint.ts'
import { thrownAuthErrorToFailure } from './thrown-auth-error-failure.ts'

const addedMemberSchema = z.object({ id: authMemberIdSchema })

/**
 * The server-side provisioning path for adding a member. The user must already exist; this invites
 * nobody. Like createAuthOrganization it needs no session headers, which is what plan 4.7's gate
 * needs; unlike it, this endpoint tolerates a headers option either way, and none is passed for
 * consistency with the call beside it.
 */
export async function addAuthOrganizationMember(
  options: AddAuthOrganizationMemberOptions,
): Promise<AddAuthOrganizationMemberResult> {
  const addMember = readAuthServerApiEndpoint(options.authServerInstance, 'addMember')
  if (addMember === undefined) {
    return authOrganizationsDisabledFailure('addMember')
  }

  const parsedOrganizationId = authOrganizationIdSchema.safeParse(options.authOrganizationId)
  if (!parsedOrganizationId.success) {
    return authInputInvalidFailure('organization-id')
  }
  const parsedUserId = authUserIdSchema.safeParse(options.authUserId)
  if (!parsedUserId.success) {
    return authInputInvalidFailure('user-id')
  }
  const parsedMemberRole = authMemberRoleSchema.safeParse(options.memberRole)
  if (!parsedMemberRole.success) {
    return authInputInvalidFailure('member-role')
  }

  let added: unknown
  try {
    added = await addMember({
      body: {
        organizationId: String(parsedOrganizationId.data),
        userId: String(parsedUserId.data),
        role: parsedMemberRole.data,
      },
    })
  } catch (thrownValue) {
    return thrownAuthErrorToFailure(thrownValue)
  }

  const parsedMemberId = addedMemberSchema.safeParse(added)
  if (!parsedMemberId.success) {
    return authRequestFailedFailure({
      authFailureDetail: 'Better Auth answered addMember without a membership id',
    })
  }

  return {
    kind: 'auth-organization-member-added',
    authMemberId: parsedMemberId.data.id,
    authOrganizationId: parsedOrganizationId.data,
    authUserId: parsedUserId.data,
    memberRole: parsedMemberRole.data,
  }
}
