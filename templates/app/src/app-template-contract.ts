import {
  configEnvSchemaFragment,
  configInvalidErrorPrefix,
  envVariableNameSchema,
} from '@hearthkit/config'
import type { EnvSource } from '@hearthkit/config'
import {
  healthCheckNameSchema,
  healthCheckResultSchema,
  observabilityEnvSchemaFragment,
} from '@hearthkit/observability'
import type { HealthCheckName, NamedHealthCheck } from '@hearthkit/observability'
import {
  hearthkitThemeCssImportSpecifier,
  tailwindSourceDirectiveForUi,
} from '@hearthkit/ui/ui-contract'
import { z } from 'zod'

/** Workspace-only package name of the template; @hearthkit/create rewrites it to the generated project name. */
export const appTemplatePackageName = '@hearthkit/app-template'

/** Exact Next.js version the template pins; 16.3.3 is the first release that loads next.config.ts without the TypeScript JS API. */
export const appTemplateNextVersion = '16.3.3'

/** Exact TypeScript version the template pins; the whole workspace stays on TS 7 and Next uses the project-local tsc CLI. */
export const appTemplateTypescriptVersion = '7.0.2'

/** Exact version pinned for both tailwindcss and @tailwindcss/postcss, which always move together. */
export const appTemplateTailwindVersion = '4.3.3'

/** Exact @playwright/test version the template pins for the smoke test. */
export const appTemplatePlaywrightVersion = '1.62.1'

/** Node major version the template runs on, in the container image and in CI. */
export const appTemplateNodeMajorVersion = 24

/** Exact Node version pinned in .nvmrc and the engines field; the container image tag carries the same value. */
export const appTemplateNodeVersion = '24.20.0'

// The character class carries `[`, `]`, `(`, `)` and `@` because Next.js route conventions put them
// in real directory names: `app/api/auth/[...all]/route.ts` is the catch-all the auth section needs,
// and route groups `(name)` and parallel routes `@name` are the same family. The `..` guard is
// unchanged and still rejects a parent segment, and `[...all]`'s three dots are not a `..` segment.
/** Relative POSIX path inside the template or a generated project; no leading slash and no parent segment, branded so path strings are validated before use. */
export const appTemplateRelativePathSchema = z
  .string()
  .regex(/^(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._@()[\]-]+(?:\/[A-Za-z0-9._@()[\]-]+)*$/)
  .max(255)
  .brand<'AppTemplateRelativePath'>()

/** Branded relative path used everywhere this contract names a file in the template tree. */
export type AppTemplateRelativePath = z.infer<typeof appTemplateRelativePathSchema>

/** Every path templates/app must contain whatever the optional-package selection is; each optional package's own paths live in appTemplateSectionsByOptionalPackage instead, so this list stays the always-present set. */
export const appTemplateGuaranteedPaths = [
  '.dockerignore',
  '.env.example',
  '.github/workflows/ci.yml',
  '.github/workflows/deploy.yml',
  '.nvmrc',
  '.oxlintrc.json',
  'Dockerfile',
  'README.md',
  'app-health-checks.ts',
  'app-runtime-config.ts',
  'app/globals.css',
  'app/health/route.ts',
  'app/layout.tsx',
  'app/page.tsx',
  'docs/theming.md',
  'e2e/app-smoke.spec.ts',
  'gitignore',
  'instrumentation.ts',
  'next.config.ts',
  'package.json',
  'playwright.config.ts',
  'postcss.config.mjs',
  'public/.gitkeep',
  'start-standalone-server.ts',
  'tsconfig.json',
] as const

/** Guaranteed template path as an enum, so a gate can report which literal path is missing. */
export const appTemplateGuaranteedPathSchema = z.enum(appTemplateGuaranteedPaths)

/** One of the guaranteed template paths, for example 'app/globals.css'. */
export type AppTemplateGuaranteedPath = z.infer<typeof appTemplateGuaranteedPathSchema>

/** Directories holding everything hearthkit-only: this contract, the shape gates, their fixtures, and the container verify script. */
export const appTemplateRepoOnlyDirectoryNames = ['src', 'test-fixtures'] as const

/** Files outside the repo-only directories that must never reach a generated project. */
export const appTemplateRepoOnlyPaths = ['CONTRACT.md', 'vitest.config.mts'] as const

/** Files stored under one name in the template and written under another by the scaffolder; npm strips a nested .gitignore from a published tarball. */
export const appTemplateRenamedPaths = [
  { templatePath: 'gitignore', generatedProjectPath: '.gitignore' },
] as const

/** Every path a project scaffolded with NO optional package selected must contain, and nothing more: appTemplateGuaranteedPaths with appTemplateRenamedPaths applied, both sorted. */
export const appGeneratedProjectGuaranteedPaths = [
  '.dockerignore',
  '.env.example',
  '.github/workflows/ci.yml',
  '.github/workflows/deploy.yml',
  '.gitignore',
  '.nvmrc',
  '.oxlintrc.json',
  'Dockerfile',
  'README.md',
  'app-health-checks.ts',
  'app-runtime-config.ts',
  'app/globals.css',
  'app/health/route.ts',
  'app/layout.tsx',
  'app/page.tsx',
  'docs/theming.md',
  'e2e/app-smoke.spec.ts',
  'instrumentation.ts',
  'next.config.ts',
  'package.json',
  'playwright.config.ts',
  'postcss.config.mjs',
  'public/.gitkeep',
  'start-standalone-server.ts',
  'tsconfig.json',
] as const

/** Build output and dependency directories the scaffolder must never copy, even when they exist in the template working tree. */
export const appTemplateNeverCopiedDirectoryNames = [
  'node_modules',
  '.next',
  'test-results',
  'playwright-report',
] as const

/** File names that are build output or OS noise which may exist on disk beside the template and never belong to a project; the scaffolder skips them wherever they appear. */
export const appTemplateNeverCopiedFileNames = [
  'next-env.d.ts',
  'tsconfig.tsbuildinfo',
  '.DS_Store',
] as const

/** package.json scripts every generated project gets; the project's own ci.yml calls lint, typecheck, and test:e2e. */
export const appTemplateGuaranteedScriptNames = [
  'dev',
  'build',
  'start',
  'lint',
  'typecheck',
  'test:e2e',
] as const

/** package.json scripts that exist only in the hearthkit workspace: the fast shape gates and the batched container verify. */
export const appTemplateRepoOnlyScriptNames = ['test', 'verify:container'] as const

/** Script the verify:container command runs; hearthkit-only, so it lives under a repo-only directory. */
export const appTemplateVerifyContainerScriptPath = 'src/verify-app-container.ts'

/** hearthkit packages every project depends on and lists in transpilePackages whatever the selection is; an optional package adds its own names through appTemplateSectionsByOptionalPackage, never to this list. */
export const appTemplateRequiredPackageNames = [
  '@hearthkit/config',
  '@hearthkit/observability',
  '@hearthkit/ui',
] as const

/** Dev dependencies that exist only for the hearthkit-only files and are removed when the template is scaffolded. */
export const appTemplateRepoOnlyDependencyNames = ['vitest', 'zod'] as const

/** Specifier every @hearthkit/* dependency carries inside the workspace; the scaffolder replaces it with a published version range. */
export const appTemplateWorkspaceDependencySpecifier = 'workspace:*'

/** Everything the scaffolder must change rather than copy verbatim; anything not named here is copied byte for byte, the four optional-package targets only ever delete, and organizations-flag-literal is the single value substitution in source (ruled 2026-09-07). */
export const appTemplateScaffoldRewriteTargets = [
  'project-package-name',
  'hearthkit-dependency-specifier',
  'repo-only-script',
  'repo-only-dependency',
  'gitignore-file-rename',
  'optional-package-section',
  'optional-package-block',
  'optional-package-dependency',
  'optional-package-script',
  // Rewrites exactly one line of app-auth-server.ts, `export const appOrganizationsEnabled = false`, to `true` when the organizations flag is on; nothing else in source is ever substituted.
  'organizations-flag-literal',
] as const

/** Scaffold rewrite target as an enum, so a Phase 6 gate can report which rewrite was skipped. */
export const appTemplateScaffoldRewriteTargetSchema = z.enum(appTemplateScaffoldRewriteTargets)

/** One thing @hearthkit/create must rewrite when it copies the template. */
export type AppTemplateScaffoldRewriteTarget = z.infer<
  typeof appTemplateScaffoldRewriteTargetSchema
>

/** Environment variables present whatever the optional-package selection is; a project with no optional package validates exactly these and .env.example documents exactly these outside every section block. */
export const appTemplateEnvVariableNames = ['NODE_ENV', 'GLITCHTIP_DSN', 'LOG_LEVEL'] as const

/** Environment variables the Next standalone server reads directly; the Dockerfile sets both and config never validates them. */
export const appTemplateContainerEnvVariableNames = ['PORT', 'HOSTNAME'] as const

/** Composed boot schema of the Phase 4 template: config's fragment extended with observability's, with no required variable. */
export const appRuntimeConfigSchema = configEnvSchemaFragment.extend(
  observabilityEnvSchemaFragment.shape,
)

/** Frozen config object the app boots with; every field is defaulted or optional until a Phase 5 package adds a required variable. */
export type AppRuntimeConfig = Readonly<z.infer<typeof appRuntimeConfigSchema>>

/** Signature of requireAppRuntimeConfig in app-runtime-config.ts: throws on any invalid value, env defaults to process.env. */
export type RequireAppRuntimeConfig = (options?: { env?: EnvSource }) => AppRuntimeConfig

/** Named health checks app-health-checks.ts exports and app/health/route.ts hands to createHealthRouteHandler. */
export type AppHealthCheckRegistry = readonly NamedHealthCheck[]

/** Health check names registered whatever the optional-package selection is, which is none; an optional package's checks are the healthCheckNames of its entry in appTemplateSectionsByOptionalPackage. */
export const appTemplateHealthCheckNames = [] as const satisfies readonly HealthCheckName[]

/** The four optional packages a project may select; @hearthkit/db is not among them, because plan 4.2 makes it a package auth and payments pull in rather than one a project picks. */
export const appTemplateOptionalPackageNames = [
  '@hearthkit/storage',
  '@hearthkit/email',
  '@hearthkit/auth',
  '@hearthkit/payments',
] as const

/** Optional package name as an enum, so a failure can report which package a path, block or variable belongs to. */
export const appTemplateOptionalPackageNameSchema = z.enum(appTemplateOptionalPackageNames)

/** One optional package name, for example '@hearthkit/storage'. */
export type AppTemplateOptionalPackageName = z.infer<typeof appTemplateOptionalPackageNameSchema>

/** Everything one optional package owns in the template; ownedTemplatePaths and envVariableNames are exclusive to one package, every other list is unioned across the selected packages and deduplicated. */
export type AppTemplateOptionalPackageSection = {
  readonly sectionRoutePath: string
  readonly flowSpecPath: string
  readonly ownedTemplatePaths: readonly string[]
  readonly blockPrunedPaths: readonly string[]
  readonly envVariableNames: readonly string[]
  readonly healthCheckNames: readonly string[]
  readonly hearthkitDependencyNames: readonly string[]
  readonly devDependencyNames: readonly string[]
  readonly packageScriptNames: readonly string[]
  readonly requiredOptionalPackageNames: readonly AppTemplateOptionalPackageName[]
}

// `packageScriptNames` covers two cases and the difference is which list the name is already in. A
// name absent from `appTemplateGuaranteedScriptNames` is ADDED with the selection and deleted
// without it, which is `db:generate`. A name already in that list is one whose VALUE the selection
// changes, which today is exactly `dev`: `next dev` for the empty selection, `hearthkit dev` as soon
// as any selected package needs local infrastructure. Both are package.json field edits, which is
// what the scaffolder has always done to a manifest; neither touches source.

/** Runtime check of one map entry; the path, variable and check-name rules are the same branded schemas the rest of hearthkit uses, so a typo in the map fails a gate rather than a build. */
export const appTemplateOptionalPackageSectionSchema = z.object({
  sectionRoutePath: z.string().startsWith('/'),
  flowSpecPath: appTemplateRelativePathSchema,
  ownedTemplatePaths: z.array(appTemplateRelativePathSchema).min(1),
  blockPrunedPaths: z.array(appTemplateRelativePathSchema).min(1),
  envVariableNames: z.array(envVariableNameSchema).min(1),
  healthCheckNames: z.array(healthCheckNameSchema),
  hearthkitDependencyNames: z.array(z.string().startsWith('@hearthkit/')).min(1),
  devDependencyNames: z.array(z.string().min(1)),
  packageScriptNames: z.array(z.string().min(1)),
  requiredOptionalPackageNames: z.array(appTemplateOptionalPackageNameSchema),
})

// One map, one truth, the same shape `localInfraServicesByHearthkitPackage` already uses in
// @hearthkit/cli. This is the value @hearthkit/create consumes in Phase 6, so its shape matters more
// than any individual section. Two ownership rules, and they are different on purpose:
//   - `ownedTemplatePaths` and `envVariableNames` are EXCLUSIVE. A path or a variable belongs to
//     exactly one package, because pruning has to be able to answer "who owns this" with one name.
//   - every other list is UNIONED and deduplicated across the selected packages, exactly as
//     `postgres` appears under both `@hearthkit/db` and `@hearthkit/auth` in the cli map.
// `requiredOptionalPackageNames` is what keeps exclusive env ownership sound: @hearthkit/auth reads
// EMAIL_TRANSPORT and EMAIL_FROM through `createAuthServerInstance`'s `emailTransportConfig`, and
// those variables live in @hearthkit/email's block, so a selection carrying auth must carry email.
/** What each optional package owns in the template: its section route, its Playwright flow, the paths it owns outright, the always-present files it has marked blocks in, and the variables, health checks, dependencies and scripts it contributes. */
export const appTemplateSectionsByOptionalPackage = {
  '@hearthkit/storage': {
    sectionRoutePath: '/storage',
    flowSpecPath: 'e2e/storage-upload-flow.spec.ts',
    ownedTemplatePaths: [
      'app-storage-connection.ts',
      'app/api/storage/download-url/route.ts',
      'app/api/storage/objects/route.ts',
      'app/api/storage/upload-url/route.ts',
      'app/storage/page.tsx',
      'e2e/storage-upload-flow.spec.ts',
    ],
    blockPrunedPaths: ['.env.example', 'app-runtime-config.ts', 'next.config.ts'],
    envVariableNames: [
      'STORAGE_ENDPOINT',
      'STORAGE_BUCKET',
      'STORAGE_REGION',
      'STORAGE_ACCESS_KEY_ID',
      'STORAGE_SECRET_ACCESS_KEY',
    ],
    healthCheckNames: [],
    hearthkitDependencyNames: ['@hearthkit/storage'],
    devDependencyNames: ['@hearthkit/cli'],
    packageScriptNames: ['dev'],
    requiredOptionalPackageNames: [],
  },
  '@hearthkit/email': {
    sectionRoutePath: '/email',
    flowSpecPath: 'e2e/email-send-flow.spec.ts',
    ownedTemplatePaths: [
      'app-email-test-template.tsx',
      'app-email-transport.ts',
      'app/api/email/test-message/route.ts',
      'app/email/page.tsx',
      'e2e/email-send-flow.spec.ts',
    ],
    blockPrunedPaths: ['.env.example', 'app-runtime-config.ts', 'next.config.ts'],
    envVariableNames: [
      'EMAIL_TRANSPORT',
      'EMAIL_FROM',
      'EMAIL_SMTP_HOST',
      'EMAIL_SMTP_PORT',
      'EMAIL_SMTP_USER',
      'EMAIL_SMTP_PASSWORD',
      'EMAIL_RESEND_API_KEY',
      'EMAIL_RESEND_BASE_URL',
    ],
    healthCheckNames: [],
    hearthkitDependencyNames: ['@hearthkit/email'],
    devDependencyNames: ['@hearthkit/cli'],
    packageScriptNames: ['dev'],
    requiredOptionalPackageNames: [],
  },
  '@hearthkit/auth': {
    sectionRoutePath: '/sign-in',
    flowSpecPath: 'e2e/auth-sign-in-flow.spec.ts',
    ownedTemplatePaths: [
      'app-auth-server.ts',
      'app-database-client.ts',
      'app-drizzle-schema.ts',
      'app/account/page.tsx',
      'app/api/auth/[...all]/route.ts',
      'app/sign-in/page.tsx',
      'drizzle.config.ts',
      'e2e/auth-sign-in-flow.spec.ts',
    ],
    blockPrunedPaths: [
      '.env.example',
      'app-health-checks.ts',
      'app-runtime-config.ts',
      'next.config.ts',
    ],
    envVariableNames: [
      'DATABASE_URL',
      'AUTH_SECRET',
      'AUTH_BASE_URL',
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'GITHUB_CLIENT_ID',
      'GITHUB_CLIENT_SECRET',
    ],
    healthCheckNames: ['database'],
    hearthkitDependencyNames: ['@hearthkit/auth', '@hearthkit/db'],
    devDependencyNames: ['@hearthkit/cli', 'drizzle-kit'],
    packageScriptNames: ['dev', 'db:generate'],
    requiredOptionalPackageNames: ['@hearthkit/email'],
  },
  '@hearthkit/payments': {
    sectionRoutePath: '/billing',
    flowSpecPath: 'e2e/payments-checkout-flow.spec.ts',
    ownedTemplatePaths: [
      'app-payments-client.ts',
      'app/api/payments/checkout/route.ts',
      'app/api/payments/portal/route.ts',
      'app/api/payments/webhook/route.ts',
      'app/billing/page.tsx',
      'app/billing/return/page.tsx',
      'e2e/payments-checkout-flow.spec.ts',
      'payments-catalog.ts',
    ],
    blockPrunedPaths: [
      '.env.example',
      'app-drizzle-schema.ts',
      'app-runtime-config.ts',
      'drizzle.config.ts',
      'next.config.ts',
    ],
    envVariableNames: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
    healthCheckNames: [],
    hearthkitDependencyNames: ['@hearthkit/payments'],
    devDependencyNames: ['@hearthkit/cli'],
    packageScriptNames: ['dev'],
    requiredOptionalPackageNames: ['@hearthkit/auth'],
  },
} as const satisfies Record<AppTemplateOptionalPackageName, AppTemplateOptionalPackageSection>

// COMPARE THIS AS A SORTED SET, NEVER AS AN ORDERED LIST. The order below is grouped by owner for a
// reader; it does not match the key order of any envSchemaFragment. `storageEnvSchemaFragment`
// declares STORAGE_REGION last and this list has it third, so an ordered comparison fails and the
// failure looks like a defect in the map when it is a defect in the comparison.
/** Every environment variable the superset template reads: appTemplateEnvVariableNames plus each optional package's own; written out rather than derived so a gate can prove the map and this list hold the same set. */
export const appTemplateSupersetEnvVariableNames = [
  'NODE_ENV',
  'GLITCHTIP_DSN',
  'LOG_LEVEL',
  'STORAGE_ENDPOINT',
  'STORAGE_BUCKET',
  'STORAGE_REGION',
  'STORAGE_ACCESS_KEY_ID',
  'STORAGE_SECRET_ACCESS_KEY',
  'EMAIL_TRANSPORT',
  'EMAIL_FROM',
  'EMAIL_SMTP_HOST',
  'EMAIL_SMTP_PORT',
  'EMAIL_SMTP_USER',
  'EMAIL_SMTP_PASSWORD',
  'EMAIL_RESEND_API_KEY',
  'EMAIL_RESEND_BASE_URL',
  'DATABASE_URL',
  'AUTH_SECRET',
  'AUTH_BASE_URL',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
] as const

// The marker text carries no comment character, so one rule covers `#` in .env.example and `//` in a
// TypeScript file: a marker line is a line CONTAINING `<prefix> <packageName>`. That is loose on its
// own, which is why the malformed-block gate requires markers to balance and never overlap — a stray
// mention of the marker text anywhere else in a block-pruned file fails that gate rather than
// silently swallowing lines.
//
// THE MECHANISM DELETES AND DOES NOTHING ELSE. No value is rewritten, no identifier substituted, no
// placeholder filled. A need that cannot be met by deleting is not a reason to widen this; it goes
// back to the orchestrator. The two properties that keep it safe are gates, not conventions: a
// generated project must contain NO marker text at all, and must still typecheck.
//
// ABSENT AND EXPLICIT SELECTIONS BEHAVE DIFFERENTLY, AND THIS IS THE PART A READER GETS WRONG.
// An ABSENT selection returns the text unchanged, markers and all, because that is the template
// itself and the template must keep its markers to stay prunable. An EXPLICIT selection — empty,
// partial, or naming all four — deletes every unselected package's blocks whole AND strips the
// begin and end lines of every KEPT block, leaving that block's contents. So "no marker survives"
// is a property of a generated project, never of the template.
/** Opening marker of an optional package's block; a marker line contains this prefix, one space and the exact package name, after whatever comment leader that file uses. */
export const appTemplateSectionBlockBeginPrefix = 'hearthkit-section:begin'

/** Closing marker of an optional package's block; same line rule as the begin marker, and at most one block is ever open at a line. */
export const appTemplateSectionBlockEndPrefix = 'hearthkit-section:end'

/** Route segment config every section page and section route handler must export, so no section is prerendered during a next build that runs with an empty environment. */
export const appTemplateSectionDynamicMode = 'force-dynamic'

/** What the pruner decided about one template path; the optional-package variant names the owner, which is the question isPrunedTemplatePath could not answer before. */
export const appTemplatePruneDecisionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('template-path-copied') }),
  z.object({ kind: z.literal('template-path-never-copied') }),
  z.object({ kind: z.literal('template-path-repo-only') }),
  z.object({
    kind: z.literal('template-path-optional-package-unselected'),
    owningOptionalPackageName: appTemplateOptionalPackageNameSchema,
  }),
])

/** Prune decision for one template path; only template-path-copied reaches a generated project. */
export type AppTemplatePruneDecision = z.infer<typeof appTemplatePruneDecisionSchema>

/** Runtime shape of decideTemplatePathPrune options; omitting selectedOptionalPackageNames means the superset, an empty array means no optional package at all (what verify:container materializes), and the two are never the same answer. */
export const decideTemplatePathPruneOptionsSchema = z.object({
  templateRelativePath: appTemplateRelativePathSchema,
  selectedOptionalPackageNames: z.array(appTemplateOptionalPackageNameSchema).optional(),
})

/** Options type for decideTemplatePathPrune; templateRelativePath is a plain string because a caller walking a directory has not parsed it yet. */
export type DecideTemplatePathPruneOptions = {
  templateRelativePath: string
  selectedOptionalPackageNames?: readonly AppTemplateOptionalPackageName[]
}

/** Signature of decideTemplatePathPrune, which replaces the boolean isPrunedTemplatePath: pure, total, and it reads nothing from disk. */
export type DecideTemplatePathPrune = (
  options: DecideTemplatePathPruneOptions,
) => AppTemplatePruneDecision

/** Options type for pruneOptionalSectionBlocks; an absent selectedOptionalPackageNames returns the text unchanged, and every explicit selection strips markers, so the two are not the same call. */
export type PruneOptionalSectionBlocksOptions = {
  fileText: string
  selectedOptionalPackageNames?: readonly AppTemplateOptionalPackageName[]
}

/** Signature of pruneOptionalSectionBlocks: absent selection returns fileText unchanged; an explicit one deletes each unselected package's block with the blank lines after it, strips the begin and end lines of each kept block, leaves every other line byte for byte, and throws with appTemplateOptionalBlockMalformedErrorPrefix when markers do not balance. */
export type PruneOptionalSectionBlocks = (options: PruneOptionalSectionBlocksOptions) => string

// PRECEDENCE, because two of these overlap and a message names exactly one. A package may hold more
// than one block in a file, so a "duplicate" cannot mean a second block anywhere in the file — it
// can only mean a second BEGIN while that same package's block is still open, which is also a begin
// inside an open block. The tie is broken by whose block is open:
//   - a begin for a DIFFERENT package than the open one -> 'begin-inside-open-block'
//   - a begin for the SAME package as the open one      -> 'duplicate-block-for-package'
// The other two never overlap: 'begin-without-end' is a block still open at end of file, and
// 'end-without-begin' is an end marker with no block open.
/** The four ways a file's section markers can be wrong; each is a separate gate against synthetic text, so no filesystem is needed to cover them. */
export const appTemplateBlockMarkerProblemSchema = z.enum([
  'begin-without-end',
  'end-without-begin',
  'begin-inside-open-block',
  'duplicate-block-for-package',
])

/** Which marker rule a block-pruned file broke; exactly one is reported per message, per the precedence above. */
export type AppTemplateBlockMarkerProblem = z.infer<typeof appTemplateBlockMarkerProblemSchema>

/** Route path of the home page the smoke test loads. */
export const appHomeRoutePath = '/'

/** Route path of the health endpoint used by the container healthcheck, the smoke test, and Uptime Kuma later. */
export const appHealthRoutePath = '/health'

/** Exact message the instrumentation register hook logs once at info level, so a container run can prove config, logging, and stdout all work. */
export const appStartupLogMessage = 'hearthkit app started'

/** Lines app/globals.css must contain in this order; the second and third are owned by @hearthkit/ui and never retyped by hand. */
export const appTemplateGlobalsCssRequiredLines = [
  "@import 'tailwindcss';",
  `@import '${hearthkitThemeCssImportSpecifier}';`,
  tailwindSourceDirectiveForUi,
] as const

/** Value next.config.ts must set for output, which is what produces .next/standalone for the Dockerfile. */
export const appNextConfigOutputMode = 'standalone'

/** Port the container listens on and the default the smoke test targets. */
export const appContainerDefaultPort = 3000

/** Non-root user the container runs as; the official Node images ship this user, so no user is created in the Dockerfile. */
export const appContainerRunAsUserName = 'node'

/** Registry the deploy workflow pushes the image to, tagged with the commit SHA and latest. */
export const appContainerRegistryHost = 'ghcr.io'

/** Repository secret holding the full Dokploy deploy webhook URL; the deploy job skips the call when it is unset. */
export const appDokployWebhookSecretName = 'DOKPLOY_DEPLOY_WEBHOOK_URL'

/** Environment variable that points the Playwright smoke test at an already running server, which is how it runs against the container. */
export const appSmokeBaseUrlEnvVariableName = 'SMOKE_TEST_BASE_URL'

/** Base URL the smoke test uses when appSmokeBaseUrlEnvVariableName is unset, matching the port the app serves locally. */
export const appSmokeDefaultBaseUrl = `http://127.0.0.1:${String(appContainerDefaultPort)}`

// The email and auth flows read delivered mail, and WHICH Mailpit they read is an input rather than
// a constant. These specs ship into generated projects, so they can carry no Docker orchestration,
// and playwright.config.ts may not import test-fixtures/ because the tree gate forbids it. So the
// isolation cannot live in the artifact: whoever runs the Flows tier points this at a Mailpit that
// no other suite is using. Scoping reads to one address is NOT sufficient on its own — see
// CONTRACT.md under the email section for the two directions it fails to govern.
/** Environment variable naming the Mailpit HTTP API the email and auth flows read; an input, so a run can be pointed at an isolated instance. */
export const appMailpitApiBaseUrlEnvVariableName = 'MAILPIT_API_BASE_URL'

/** Mailpit HTTP API the flows use when appMailpitApiBaseUrlEnvVariableName is unset, matching what hearthkit dev infra up publishes for a project. */
export const appMailpitDefaultApiBaseUrl = 'http://127.0.0.1:8025'

/** Request body of POST /api/email/test-message; one recipient per call, matching sendTransactionalEmail's own one-recipient rule. */
export const appEmailTestMessageRequestSchema = z.object({
  recipientEmailAddress: z.string(),
})

/** Request body type of the email section's test-message route. */
export type AppEmailTestMessageRequest = z.infer<typeof appEmailTestMessageRequestSchema>

/** data-testid on the element of /billing carrying the signed-in billing reference, which the payments flow stamps into the synthesised event's metadata. */
export const appBillingReferenceTestId = 'billing-reference'

/** data-testid on each purchasable price on /billing; the flow reads its two data attributes to build a webhook payload the handler can resolve. */
export const appBillingPriceTestId = 'billing-price'

/** Attribute on a billing-price element holding the catalog price name, written to Stripe metadata as hearthkit_price_name. */
export const appBillingPriceNameAttributeName = 'data-price-name'

/** Attribute on a billing-price element holding the Stripe price id, written to Stripe metadata as hearthkit_stripe_price_id. */
export const appBillingStripePriceIdAttributeName = 'data-stripe-price-id'

/** Literal strings .github/workflows/ci.yml must contain, so the pull-request checks cannot silently lose a step. */
export const appTemplateCiWorkflowRequiredContent = [
  'pull_request',
  'pnpm install --frozen-lockfile',
  'pnpm lint',
  'pnpm typecheck',
  'playwright install',
  'pnpm test:e2e',
] as const

/** Literal strings .github/workflows/deploy.yml must contain; the last two are the guard that keeps build and push testable without a Dokploy instance. */
export const appTemplateDeployWorkflowRequiredContent = [
  'packages: write',
  'docker/login-action@v4',
  'docker/build-push-action@v7',
  appContainerRegistryHost,
  '${{ github.sha }}',
  `secrets.${appDokployWebhookSecretName}`,
  `env.${appDokployWebhookSecretName} != ''`,
] as const

/** Unique literal prefix reported when a guaranteed template path is missing from templates/app. */
export const appTemplatePathMissingErrorPrefix = 'hearthkit app template path missing:'

/** Unique literal prefix reported when a hearthkit-only file reached a generated project. */
export const appTemplateRepoOnlyPathCopiedErrorPrefix =
  'hearthkit app template repo-only path copied:'

/** Unique literal prefix reported when the scaffolder left a template-only value in a generated project. */
export const appTemplateScaffoldRewriteMissingErrorPrefix =
  'hearthkit app template scaffold rewrite missing:'

/** Unique literal prefix reported when a path owned by an unselected optional package reached a generated project. */
export const appTemplateOptionalSectionCopiedErrorPrefix =
  'hearthkit app template optional section copied:'

/** Unique literal prefix reported when a path the map says an optional package owns does not exist in templates/app; the mirror of appTemplatePathMissingErrorPrefix, which covers only appTemplateGuaranteedPaths. */
export const appTemplateOptionalSectionPathMissingErrorPrefix =
  'hearthkit app template optional section path missing:'

/** Unique literal prefix reported when an unselected optional package's marked block survived in an always-present file. */
export const appTemplateOptionalBlockCopiedErrorPrefix =
  'hearthkit app template optional block copied:'

/** Unique literal prefix reported when a block-pruned file's markers do not balance, overlap, or appear out of order. */
export const appTemplateOptionalBlockMalformedErrorPrefix =
  'hearthkit app template optional block malformed:'

/** Unique literal prefix reported when a selection names an optional package without one it requires. */
export const appTemplateOptionalSelectionIncompleteErrorPrefix =
  'hearthkit app template optional selection incomplete:'

/** Unique literal prefix reported when a variable is documented outside its owning package's .env.example block, or inside two blocks at once. */
export const appTemplateEnvBlockMismatchErrorPrefix = 'hearthkit app template env block mismatch:'

/** Unique literal prefix reported when a section's page or route handler answered outside the 2xx range; the owning package's own message is carried alongside, not re-worded. */
export const appSectionRouteFailedErrorPrefix = 'hearthkit app section route failed:'

/** Unique literal prefix reported when globals.css or the root layout lost a line the theme wiring depends on. */
export const appThemeWiringMissingErrorPrefix = 'hearthkit app theme wiring missing:'

/** Unique literal prefix reported when docker build exits nonzero for the template image. */
export const appImageBuildFailedErrorPrefix = 'hearthkit app image build failed:'

/** Unique literal prefix reported when the container started but never answered /health with 200. */
export const appContainerNotHealthyErrorPrefix = 'hearthkit app container not healthy:'

/** Unique literal prefix reported when /health answered 503 because a registered check failed or timed out. */
export const appHealthDependencyUnavailableErrorPrefix =
  'hearthkit app health dependency unavailable:'

/** Unique literal prefix verify:container prints for its own failures (a failed pnpm install, docker run or pnpm pack, a missing published port, a nonzero Playwright run); deliberately not an appTemplateFailureSchema variant, because the verification harness failed rather than the template artifact. */
export const appVerifyContainerFailedErrorPrefix = 'hearthkit app verify container failed:'

/** Every way the template can fail as an artifact; boot rejection keeps config's own message so its prefix stays greppable. */
export const appTemplateFailureSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('app-template-path-missing'),
    missingPath: appTemplateRelativePathSchema,
    message: z.string().startsWith(appTemplatePathMissingErrorPrefix),
  }),
  z.object({
    kind: z.literal('app-template-repo-only-path-copied'),
    copiedPath: appTemplateRelativePathSchema,
    message: z.string().startsWith(appTemplateRepoOnlyPathCopiedErrorPrefix),
  }),
  z.object({
    kind: z.literal('app-scaffold-rewrite-missing'),
    rewriteTarget: appTemplateScaffoldRewriteTargetSchema,
    message: z.string().startsWith(appTemplateScaffoldRewriteMissingErrorPrefix),
  }),
  z.object({
    kind: z.literal('app-template-optional-section-copied'),
    copiedPath: appTemplateRelativePathSchema,
    owningOptionalPackageName: appTemplateOptionalPackageNameSchema,
    message: z.string().startsWith(appTemplateOptionalSectionCopiedErrorPrefix),
  }),
  z.object({
    kind: z.literal('app-template-optional-section-path-missing'),
    missingPath: appTemplateRelativePathSchema,
    owningOptionalPackageName: appTemplateOptionalPackageNameSchema,
    message: z.string().startsWith(appTemplateOptionalSectionPathMissingErrorPrefix),
  }),
  z.object({
    kind: z.literal('app-template-optional-block-copied'),
    blockPrunedPath: appTemplateRelativePathSchema,
    owningOptionalPackageName: appTemplateOptionalPackageNameSchema,
    message: z.string().startsWith(appTemplateOptionalBlockCopiedErrorPrefix),
  }),
  z.object({
    kind: z.literal('app-template-optional-block-malformed'),
    blockPrunedPath: appTemplateRelativePathSchema,
    blockMarkerProblem: appTemplateBlockMarkerProblemSchema,
    owningOptionalPackageName: appTemplateOptionalPackageNameSchema,
    message: z.string().startsWith(appTemplateOptionalBlockMalformedErrorPrefix),
  }),
  z.object({
    kind: z.literal('app-template-optional-selection-incomplete'),
    selectedOptionalPackageNames: z.array(appTemplateOptionalPackageNameSchema),
    missingOptionalPackageNames: z.array(appTemplateOptionalPackageNameSchema).min(1),
    message: z.string().startsWith(appTemplateOptionalSelectionIncompleteErrorPrefix),
  }),
  z.object({
    kind: z.literal('app-template-env-block-mismatch'),
    envVariableName: envVariableNameSchema,
    owningOptionalPackageName: appTemplateOptionalPackageNameSchema,
    message: z.string().startsWith(appTemplateEnvBlockMismatchErrorPrefix),
  }),
  z.object({
    kind: z.literal('app-section-route-failed'),
    sectionRoutePath: z.string().startsWith('/'),
    owningOptionalPackageName: appTemplateOptionalPackageNameSchema,
    observedStatusCode: z.number().int(),
    owningPackageFailureMessage: z.string().min(1),
    message: z.string().startsWith(appSectionRouteFailedErrorPrefix),
  }),
  z.object({
    kind: z.literal('app-theme-wiring-missing'),
    missingLine: z.string().min(1),
    message: z.string().startsWith(appThemeWiringMissingErrorPrefix),
  }),
  z.object({
    kind: z.literal('app-boot-config-invalid'),
    message: z.string().startsWith(configInvalidErrorPrefix),
  }),
  z.object({
    kind: z.literal('app-image-build-failed'),
    buildExitCode: z.number().int(),
    buildStderrExcerpt: z.string(),
    message: z.string().startsWith(appImageBuildFailedErrorPrefix),
  }),
  z.object({
    kind: z.literal('app-container-not-healthy'),
    waitedMs: z.number().int().positive(),
    observedStatusCode: z.number().int().optional(),
    message: z.string().startsWith(appContainerNotHealthyErrorPrefix),
  }),
  z.object({
    kind: z.literal('app-health-dependency-unavailable'),
    failedHealthChecks: z.array(healthCheckResultSchema).min(1),
    message: z.string().startsWith(appHealthDependencyUnavailableErrorPrefix),
  }),
])

/** Discriminated failure union of the app template; each variant's message starts with its unique literal prefix. */
export type AppTemplateFailure = z.infer<typeof appTemplateFailureSchema>
