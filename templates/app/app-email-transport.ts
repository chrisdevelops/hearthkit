import { resolveEmailTransportConfig } from '@hearthkit/email'
import type { ResolveEmailTransportConfigResult } from '@hearthkit/email'
import { requireAppRuntimeConfig } from './app-runtime-config.ts'

/**
 * Narrows the validated environment into `@hearthkit/email`'s transport union.
 *
 * `EMAIL_TRANSPORT` and `EMAIL_FROM` are checked by the boot schema, but the per-transport variables
 * are not: which of `EMAIL_SMTP_*` or `EMAIL_RESEND_*` is required depends on the transport that was
 * named, and a Zod fragment cannot express that. `resolveEmailTransportConfig` is where that rule
 * lives, so this returns its whole result rather than throwing — the caller decides what a
 * half-configured transport should look like to a person.
 *
 * Called per request, never cached at module scope, so `next build` can prerender with an empty
 * environment.
 */
export function resolveAppEmailTransport(): ResolveEmailTransportConfigResult {
  return resolveEmailTransportConfig({ emailEnv: requireAppRuntimeConfig() })
}
