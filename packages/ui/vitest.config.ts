import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Gates import the package by its public name. The alias resolves that name to the same source
// entry the package.json "exports" field points at, so resolution does not depend on a build step.
// Components render in jsdom: no service is involved, and the theme gates only need the CSS
// cascade, which jsdom resolves for custom properties (it does not substitute var(), so the gates
// assert token values on the root element rather than substituted colours).
export default defineConfig({
  resolve: {
    alias: {
      '@hearthkit/ui': fileURLToPath(new URL('./src/index.ts', import.meta.url)),
    },
  },
  // shadcn components are .tsx files with no React import; Vite transforms .tsx with the automatic
  // JSX runtime by default, so no explicit jsx option is set here.
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./test-fixtures/jsdom-browser-api-stubs.ts'],
  },
})
