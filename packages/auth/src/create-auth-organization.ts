import { z } from 'zod'
import {
  authOrganizationIdSchema,
  authOrganizationNameSchema,
  authOrganizationSlugSchema,
  authUserIdSchema,
  type CreateAuthOrganizationOptions,
  type CreateAuthOrganizationResult,
} from './auth-contract.ts'
import {
  authInputInvalidFailure,
  authOrganizationsDisabledFailure,
  authRequestFailedFailure,
} from './auth-failure-results.ts'
import { readAuthServerApiEndpoint } from './auth-server-api-endpoint.ts'
import { thrownAuthErrorToFailure } from './thrown-auth-error-failure.ts'

const createdOrganizationSchema = z.object({ id: authOrganizationIdSchema })

/**
 * The server-side provisioning path for creating an organization. It takes the owner from the body
 * and is called WITHOUT a headers option: passing one — even `new Headers()` — makes the endpoint
 * resolve a session instead, and it throws UNAUTHORIZED 401 with `body: undefined` and an empty
 * message, which reads like a bug in the caller's own code rather than an argument mistake.
 *
 * An app's own "create organization" button uses `authBrowserClient.organization.create()`, which
 * goes through the route handler and is session-scoped by construction.
 *
 * A slug collision is not named by this package: it arrives as auth-request-failed carrying
 * `authErrorCode: 'ORGANIZATION_ALREADY_EXISTS'` and status 400, which is a caller error rather than
 * an unavailable database.
 */
export async function createAuthOrganization(
  options: CreateAuthOrganizationOptions,
): Promise<CreateAuthOrganizationResult> {
  const createOrganization = readAuthServerApiEndpoint(
    options.authServerInstance,
    'createOrganization',
  )
  if (createOrganization === undefined) {
    return authOrganizationsDisabledFailure('createOrganization')
  }

  const parsedOrganizationName = authOrganizationNameSchema.safeParse(options.organizationName)
  if (!parsedOrganizationName.success) {
    return authInputInvalidFailure('organization-name')
  }
  const parsedOrganizationSlug = authOrganizationSlugSchema.safeParse(options.organizationSlug)
  if (!parsedOrganizationSlug.success) {
    return authInputInvalidFailure('organization-slug')
  }
  const parsedOwnerAuthUserId = authUserIdSchema.safeParse(options.ownerAuthUserId)
  if (!parsedOwnerAuthUserId.success) {
    return authInputInvalidFailure('user-id')
  }

  let created: unknown
  try {
    created = await createOrganization({
      body: {
        name: String(parsedOrganizationName.data),
        slug: String(parsedOrganizationSlug.data),
        userId: String(parsedOwnerAuthUserId.data),
      },
    })
  } catch (thrownValue) {
    return thrownAuthErrorToFailure(thrownValue)
  }

  const parsedOrganizationId = createdOrganizationSchema.safeParse(created)
  if (!parsedOrganizationId.success) {
    return authRequestFailedFailure({
      authFailureDetail: 'Better Auth answered createOrganization without an organization id',
    })
  }

  return {
    kind: 'auth-organization-created',
    authOrganizationId: parsedOrganizationId.data.id,
    organizationName: parsedOrganizationName.data,
    organizationSlug: parsedOrganizationSlug.data,
    ownerAuthUserId: parsedOwnerAuthUserId.data,
  }
}
