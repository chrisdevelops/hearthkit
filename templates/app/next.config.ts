import type { NextConfig } from 'next'

/**
 * Next.js configuration.
 *
 * `standalone` output is what writes `.next/standalone`, the self-contained server the Dockerfile
 * copies into the runner stage. `transpilePackages` lists every `@hearthkit/*` dependency, because
 * those packages ship TypeScript source rather than a build; add a package here whenever you add it
 * to `package.json`.
 *
 * Two settings are deliberately absent. `experimental.useTypeScriptCli` is already the default in
 * Next 16.3.3, so setting it would only claim a dependency on an experimental opt-in that no longer
 * exists. `outputFileTracingRoot` is unset because this project is its own tracing root.
 */
const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@hearthkit/config', '@hearthkit/observability', '@hearthkit/ui'],
}

export default nextConfig
