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

const expectedFunctionNames = [
  'resolveEmailTransportConfig',
  'renderTransactionalEmail',
  'sendTransactionalEmail',
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

  const missingNames: string[] = expectedFunctionNames.filter(
    (exportName) => typeof namespace[exportName] !== 'function',
  )
  for (const templateName of expectedTemplateNames) {
    // Checked against the contract's own runtime schema, so an export that exists but is not a usable
    // template is reported here rather than as an unreadable failure inside a gate.
    if (!transactionalEmailTemplateSchema.safeParse(namespace[templateName]).success) {
      missingNames.push(templateName)
    }
  }
  if (namespace.emailEnvSchemaFragment === undefined) {
    missingNames.push('emailEnvSchemaFragment')
  }
  if (missingNames.length > 0) {
    throw new Error(`gate expected @hearthkit/email to export ${missingNames.join(', ')}`)
  }

  return namespace as unknown as HearthkitEmailEntry
}
