/**
 * The one source line create is ever allowed to substitute a value into.
 *
 * `appOrganizationsEnabled` is a scaffold literal rather than an environment variable, because
 * user-scoped and organization-scoped billing key their rows differently and a running deployment
 * must not be able to switch. No marked block and no manifest field can express "this literal becomes
 * true", which is why `organizations-flag-literal` is a declared rewrite target of its own. Every
 * other rewrite either deletes or edits package.json.
 */

/** The literal the template ships, which app-payments-client.ts branches on at build time. */
export const appOrganizationsDisabledSourceLine =
  'export const appOrganizationsEnabled = false' as const

/** The literal a project scaffolded with organizations gets instead; a literal true, never an expression. */
export const appOrganizationsEnabledSourceLine =
  'export const appOrganizationsEnabled = true' as const

/** Rewrites the organizations flag to true wherever the template declared it false; every other line is untouched. */
export function rewriteOrganizationsFlagLiteral(fileText: string): string {
  return fileText.replaceAll(appOrganizationsDisabledSourceLine, appOrganizationsEnabledSourceLine)
}
