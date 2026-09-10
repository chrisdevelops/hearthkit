import type * as emailContract from '../src/email-contract.ts'
import {
  transactionalEmailTemplateSchema,
  type MagicLinkEmailProps,
  type PasswordResetEmailProps,
  type RenderTransactionalEmail,
  type ResolveEmailTransportConfig,
  type SendTransactionalEmail,
  type TransactionalEmailTemplate,
} from '../src/email-contract.ts'

/** The env fragment's own type, read off the contract module so this fixture declares no second copy of it. */
export type EmailEnvSchemaFragment = typeof emailContract.emailEnvSchemaFragment

/** The whole public surface a gate is allowed to call; nothing here may be imported from an internal module. */
export type HearthkitEmailEntry = {
  resolveEmailTransportConfig: ResolveEmailTransportConfig
  renderTransactionalEmail: RenderTransactionalEmail
  sendTransactionalEmail: SendTransactionalEmail
  magicLinkEmailTemplate: TransactionalEmailTemplate<MagicLinkEmailProps>
  passwordResetEmailTemplate: TransactionalEmailTemplate<PasswordResetEmailProps>
  emailEnvSchemaFragment: EmailEnvSchemaFragment
}

/**
 * The fifteen value exports CONTRACT.md "Package entry point" allows src/index.ts to have, spelled
 * out because the allowlist is a decision no module namespace can be derived from: every other value
 * email-contract.ts exports is internal and must stay off the entry point.
 */
export const hearthkitEmailEntryValueExportNames = [
  'resolveEmailTransportConfig',
  'renderTransactionalEmail',
  'sendTransactionalEmail',
  'magicLinkEmailTemplate',
  'passwordResetEmailTemplate',
  'emailEnvSchemaFragment',
  'emailFailureSchema',
  'emailTransportConfigSchema',
  'resolveEmailTransportConfigResultSchema',
  'renderTransactionalEmailResultSchema',
  'sendTransactionalEmailResultSchema',
  'emailLinkUrlSchema',
  'emailProductNameSchema',
  'emailTemplateNameSchema',
  'emailSubjectSchema',
] as const

/**
 * The ten allowlisted names the ./email-contract subpath carries: the same list minus the three
 * functions and the two templates, which live in .tsx-importing modules a bare node process refuses.
 */
export const hearthkitEmailContractSubpathValueExportNames = [
  'emailEnvSchemaFragment',
  'emailFailureSchema',
  'emailTransportConfigSchema',
  'resolveEmailTransportConfigResultSchema',
  'renderTransactionalEmailResultSchema',
  'sendTransactionalEmailResultSchema',
  'emailLinkUrlSchema',
  'emailProductNameSchema',
  'emailTemplateNameSchema',
  'emailSubjectSchema',
] as const

const expectedTemplateNames = ['magicLinkEmailTemplate', 'passwordResetEmailTemplate'] as const

/**
 * Imports @hearthkit/email through its public entry point at call time, so a package with no
 * implementation yet fails one gate at a time instead of breaking collection for a whole file.
 */
export async function importHearthkitEmailNamespace(): Promise<Record<string, unknown>> {
  try {
    return (await import('@hearthkit/email')) as Record<string, unknown>
  } catch (error) {
    throw new Error(
      `gate could not load the public entry point of @hearthkit/email (not implemented yet?): ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
}

/**
 * Imports the ./email-contract subpath through the manifest at call time, so a subpath that still
 * points at a module nobody has written yet fails one gate instead of breaking a whole file.
 */
export async function importHearthkitEmailContractSubpathNamespace(): Promise<
  Record<string, unknown>
> {
  try {
    return (await import('@hearthkit/email/email-contract')) as Record<string, unknown>
  } catch (error) {
    throw new Error(
      `gate could not load the ./email-contract subpath of @hearthkit/email (not implemented yet?): ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
}

/**
 * The public entry point narrowed to the surface the contract promises. Throws naming whatever is not
 * exported yet, because a missing named export resolves to undefined rather than throwing in this
 * repo's Vitest setup, which would let a gate pass while checking nothing.
 */
export async function loadHearthkitEmailEntry(): Promise<HearthkitEmailEntry> {
  const namespace = await importHearthkitEmailNamespace()

  const missingNames: string[] = hearthkitEmailEntryValueExportNames.filter(
    (exportName) => namespace[exportName] === undefined,
  )
  for (const templateName of expectedTemplateNames) {
    // Checked against the contract's own runtime schema, so an export that exists but is not a usable
    // template is reported here rather than as an unreadable failure inside a gate.
    if (
      !missingNames.includes(templateName) &&
      !transactionalEmailTemplateSchema.safeParse(namespace[templateName]).success
    ) {
      missingNames.push(templateName)
    }
  }
  if (missingNames.length > 0) {
    throw new Error(`gate expected @hearthkit/email to export ${missingNames.join(', ')}`)
  }

  return namespace as unknown as HearthkitEmailEntry
}
