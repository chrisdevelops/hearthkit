import type { NextConfig } from 'next'

/**
 * Next.js configuration.
 *
 * `standalone` output is what writes `.next/standalone`, the self-contained server the Dockerfile
 * copies into the runner stage. `transpilePackages` lists every `@hearthkit/*` dependency, because
 * those packages ship TypeScript source rather than a build; add a package here whenever you add it
 * to `package.json`.
 *
 * The `hearthkit-section` comments delimit the entries one optional package owns. Transpiling a
 * package a project no longer depends on fails the build with a resolution error rather than being
 * ignored, which is why these entries are pruned with the section rather than left behind.
 *
 * Three settings are deliberately absent. `experimental.useTypeScriptCli` is already the default in
 * Next 16.3.3, so setting it would only claim a dependency on an experimental opt-in that no longer
 * exists. `outputFileTracingRoot` is unset because this project is its own tracing root.
 * `cacheComponents` is unset because turning it on removes the `dynamic` route segment config every
 * section page and route handler depends on.
 */
const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: [
    '@hearthkit/config',
    '@hearthkit/observability',
    '@hearthkit/ui',
    // hearthkit-section:begin @hearthkit/storage
    '@hearthkit/storage',
    // hearthkit-section:end @hearthkit/storage
    // hearthkit-section:begin @hearthkit/email
    '@hearthkit/email',
    // hearthkit-section:end @hearthkit/email
    // hearthkit-section:begin @hearthkit/auth
    '@hearthkit/db',
    '@hearthkit/auth',
    // hearthkit-section:end @hearthkit/auth
    // hearthkit-section:begin @hearthkit/payments
    '@hearthkit/payments',
    // hearthkit-section:end @hearthkit/payments
  ],
}

export default nextConfig
