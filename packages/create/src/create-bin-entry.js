#!/usr/bin/env node
// The `create-hearthkit-project` bin, and plain JavaScript for the reason spelled out in full in
// @hearthkit/config's `src/register-node-modules-type-stripping.js`: Node 24.20.0 refuses to strip
// types from a `.ts` file under `node_modules`, so the bin `pnpm create @hearthkit` runs cannot
// itself be TypeScript. The hook lives in @hearthkit/config, which this package already depends on,
// so there is one copy of it rather than one per entry point.
//
// `create-bin.ts` is reached by a dynamic import, and that is load-bearing rather than a style
// choice. Node loads the source of an entire static module graph before it evaluates any of it, so
// a static `import './create-bin.ts'` would be read off disk while the hook module below is still
// unevaluated, and would throw ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING. The dynamic import
// runs after this module body, by which time the hook is registered.
//
// API reference checked against the current Node 24 docs on 2026-09-07:
// https://nodejs.org/docs/latest-v24.x/api/module.html

import '@hearthkit/config/register-node-modules-type-stripping'

await import('./create-bin.ts')
