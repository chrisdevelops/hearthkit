import { configEnvSchemaFragment, configInvalidErrorPrefix } from '@hearthkit/config'
import type { EnvSource } from '@hearthkit/config'
import { healthCheckResultSchema, observabilityEnvSchemaFragment } from '@hearthkit/observability'
import type { HealthCheckName, NamedHealthCheck } from '@hearthkit/observability'
import { hearthkitThemeCssImportSpecifier, tailwindSourceDirectiveForUi } from '@hearthkit/ui'
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

/** Node major version the template runs on, in the container image, in CI, and in the engines field. */
export const appTemplateNodeMajorVersion = 24

/** Relative POSIX path inside the template or a generated project; no leading slash and no parent segment, branded so path strings are validated before use. */
export const appTemplateRelativePathSchema = z
  .string()
  .regex(/^(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/)
  .max(255)
  .brand<'AppTemplateRelativePath'>()

/** Branded relative path used everywhere this contract names a file in the template tree. */
export type AppTemplateRelativePath = z.infer<typeof appTemplateRelativePathSchema>

/** Every path templates/app must contain; the template's shape gate and @hearthkit/create both assert against this list rather than prose. */
export const appTemplateGuaranteedPaths = [
  '.dockerignore',
  '.env.example',
  '.github/workflows/ci.yml',
  '.github/workflows/deploy.yml',
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

/** Every path a generated project must contain: appTemplateGuaranteedPaths with appTemplateRenamedPaths applied, both sorted. */
export const appGeneratedProjectGuaranteedPaths = [
  '.dockerignore',
  '.env.example',
  '.github/workflows/ci.yml',
  '.github/workflows/deploy.yml',
  '.gitignore',
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
  'tsconfig.json',
] as const

/** Build output and dependency directories the scaffolder must never copy, even when they exist in the template working tree. */
export const appTemplateNeverCopiedDirectoryNames = [
  'node_modules',
  '.next',
  'test-results',
  'playwright-report',
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

/** hearthkit packages the template wires and lists in transpilePackages; Phase 5 packages are added to this list when their section lands. */
export const appTemplateRequiredPackageNames = [
  '@hearthkit/config',
  '@hearthkit/observability',
  '@hearthkit/ui',
] as const

/** Dev dependencies that exist only for the hearthkit-only files and are removed when the template is scaffolded. */
export const appTemplateRepoOnlyDependencyNames = ['vitest', 'zod'] as const

/** Specifier every @hearthkit/* dependency carries inside the workspace; the scaffolder replaces it with a published version range. */
export const appTemplateWorkspaceDependencySpecifier = 'workspace:*'

/** Everything the scaffolder must change rather than copy verbatim; anything not named here is copied byte for byte. */
export const appTemplateScaffoldRewriteTargets = [
  'project-package-name',
  'hearthkit-dependency-specifier',
  'repo-only-script',
  'repo-only-dependency',
  'gitignore-file-rename',
] as const

/** Scaffold rewrite target as an enum, so a Phase 6 gate can report which rewrite was skipped. */
export const appTemplateScaffoldRewriteTargetSchema = z.enum(appTemplateScaffoldRewriteTargets)

/** One thing @hearthkit/create must rewrite when it copies the template. */
export type AppTemplateScaffoldRewriteTarget = z.infer<
  typeof appTemplateScaffoldRewriteTargetSchema
>

/** Environment variables the running app validates through @hearthkit/config; .env.example documents exactly these. */
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

/** Health check names the Phase 4 template registers, which is none; each Phase 5 package that owns a dependency appends one. */
export const appTemplateHealthCheckNames = [] as const satisfies readonly HealthCheckName[]

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

/** Unique literal prefix reported when globals.css or the root layout lost a line the theme wiring depends on. */
export const appThemeWiringMissingErrorPrefix = 'hearthkit app theme wiring missing:'

/** Unique literal prefix reported when docker build exits nonzero for the template image. */
export const appImageBuildFailedErrorPrefix = 'hearthkit app image build failed:'

/** Unique literal prefix reported when the container started but never answered /health with 200. */
export const appContainerNotHealthyErrorPrefix = 'hearthkit app container not healthy:'

/** Unique literal prefix reported when /health answered 503 because a registered check failed or timed out. */
export const appHealthDependencyUnavailableErrorPrefix =
  'hearthkit app health dependency unavailable:'

/** Unique literal prefix reported when a required workflow line is missing from ci.yml or deploy.yml. */
export const appWorkflowContentMissingErrorPrefix = 'hearthkit app workflow content missing:'

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
    kind: z.literal('app-theme-wiring-missing'),
    missingLine: z.string().min(1),
    message: z.string().startsWith(appThemeWiringMissingErrorPrefix),
  }),
  z.object({
    kind: z.literal('app-workflow-content-missing'),
    workflowPath: appTemplateRelativePathSchema,
    missingLine: z.string().min(1),
    message: z.string().startsWith(appWorkflowContentMissingErrorPrefix),
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
