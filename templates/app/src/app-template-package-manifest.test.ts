import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { jsonObjectAt } from '../test-fixtures/app-template-gate-expectations.ts'
import {
  hearthkitRepoRootPath,
  readJsonFileAt,
  readTemplateJsonFile,
  templateFileExists,
} from '../test-fixtures/app-template-tree-files.ts'
import {
  appTemplateGuaranteedScriptNames,
  appTemplateNextVersion,
  appTemplateNodeMajorVersion,
  appTemplateOptionalPackageNames,
  appTemplatePackageName,
  appTemplatePlaywrightVersion,
  appTemplateRepoOnlyDependencyNames,
  appTemplateRepoOnlyScriptNames,
  appTemplateRequiredPackageNames,
  appTemplateSectionsByOptionalPackage,
  appTemplateTailwindVersion,
  appTemplateTypescriptVersion,
  appTemplateVerifyContainerScriptPath,
  appTemplateWorkspaceDependencySpecifier,
} from './app-template-contract.ts'

/** Everything the four sections contribute to the manifest, unioned and deduplicated as the contract says they are. */
const optionalHearthkitDependencyNames = [
  ...new Set(
    appTemplateOptionalPackageNames.flatMap(
      (optionalPackageName) =>
        appTemplateSectionsByOptionalPackage[optionalPackageName].hearthkitDependencyNames,
    ),
  ),
]

const optionalDevDependencyNames = [
  ...new Set(
    appTemplateOptionalPackageNames.flatMap(
      (optionalPackageName) =>
        appTemplateSectionsByOptionalPackage[optionalPackageName].devDependencyNames,
    ),
  ),
]

const optionalPackageScriptNames = [
  ...new Set(
    appTemplateOptionalPackageNames.flatMap(
      (optionalPackageName) =>
        appTemplateSectionsByOptionalPackage[optionalPackageName].packageScriptNames,
    ),
  ),
]

/**
 * The exact command each shipped script runs, as the contract's script table writes it.
 *
 * `dev` is the one whose VALUE a selection changes: `next dev` for the empty selection, `hearthkit
 * dev` as soon as any selected package needs local infrastructure — which is all four, so the
 * superset template carries the CLI form. That is a package.json field edit like every other one the
 * scaffolder makes to a manifest, and it is why `dev` appears in every packageScriptNames list.
 *
 * `start` is NOT `next start`, and it is not the literal `node .next/standalone/server.js` either.
 * next.config.ts sets `output: 'standalone'`, which Next 16.3.3 refuses to serve with `next start`.
 * The emitted server then sits at a path that depends on where the tracing root landed: inside this
 * workspace it is `.next/standalone/templates/app/server.js`, because pnpm-workspace.yaml sits above
 * templates/app, and in a materialized project with no workspace above it, it is at the root. A
 * literal would work in a generated project and ENOENT here, which is exactly where the flows run.
 * The script bridges the two layouts, and a bare `node` runs its .ts entry point because Node 24
 * strips types with no flag.
 */
const expectedScriptCommands: Record<string, string> = {
  dev: 'hearthkit dev',
  build: 'next build',
  start: 'node start-standalone-server.ts',
  lint: 'oxlint --type-aware .',
  typecheck: 'next typegen && tsc --noEmit',
  'test:e2e': 'playwright test',
  test: 'vitest run',
  'db:generate': 'drizzle-kit generate',
}

const readTemplatePackageJson = (): Record<string, unknown> => readTemplateJsonFile('package.json')

const readRepoRootPackageJson = (): Record<string, unknown> =>
  readJsonFileAt(join(hearthkitRepoRootPath, 'package.json'))

const readUiPackageJson = (): Record<string, unknown> =>
  readJsonFileAt(join(hearthkitRepoRootPath, 'packages', 'ui', 'package.json'))

const stringFieldAt = (jsonObject: Record<string, unknown>, key: string): string => {
  const value = jsonObject[key]
  return typeof value === 'string' ? value : ''
}

describe('templates/app package.json', () => {
  it('identifies itself as the private workspace template and sets no type field', () => {
    const packageJson = readTemplatePackageJson()

    expect(packageJson.name).toBe(appTemplatePackageName)
    expect(packageJson.private).toBe(true)
    expect(packageJson.version).toBe('0.0.0')
    expect(stringFieldAt(jsonObjectAt(packageJson, 'engines'), 'node')).toBe(
      `>=${String(appTemplateNodeMajorVersion)}`,
    )

    // One package manager version for the whole repo; the template must not drift from the root.
    expect(packageJson.packageManager).toBe(readRepoRootPackageJson().packageManager)

    // "type": "module" next to Next's CommonJS standalone server.js is a long-standing breakage,
    // and nothing in the tree needs the field, so its absence is part of the contract.
    expect(Object.keys(packageJson)).not.toContain('type')
  })

  it('declares every shipped script and keeps the fast test script free of Playwright and Docker', () => {
    const scripts = jsonObjectAt(readTemplatePackageJson(), 'scripts')

    const missingScriptNames = [
      ...appTemplateGuaranteedScriptNames,
      ...appTemplateRepoOnlyScriptNames,
      ...optionalPackageScriptNames,
    ].filter((scriptName) => stringFieldAt(scripts, scriptName) === '')
    expect(missingScriptNames).toEqual([])

    // A packageScriptNames entry is either a script the package ADDS (db:generate) or one whose
    // VALUE the selection changes (dev, already guaranteed). Which case applies is decided by
    // whether the name is already in appTemplateGuaranteedScriptNames, and both must be spelled out
    // above, or the superset manifest could satisfy this gate with a script nobody named.
    const addedScriptNames = optionalPackageScriptNames.filter(
      (scriptName) => !(appTemplateGuaranteedScriptNames as readonly string[]).includes(scriptName),
    )
    expect(addedScriptNames).toEqual(['db:generate'])
    expect(optionalPackageScriptNames).toContain('dev')

    for (const [scriptName, command] of Object.entries(expectedScriptCommands)) {
      expect(scripts[scriptName], `script ${scriptName}`).toBe(command)
    }

    // The repo-root pull request job runs `pnpm --recursive --if-present run test`. If the fast tier
    // ever grew a browser or a container, every pull request in the repo would pay for it.
    const fastTierCommand = stringFieldAt(scripts, 'test')
    for (const forbiddenWord of ['playwright', 'docker', 'verify:container']) {
      expect(fastTierCommand).not.toContain(forbiddenWord)
    }

    // The batched tier is a separate script that runs the hearthkit-only verify entry point, so a
    // Docker build and a browser only ever happen when someone asks for them by name.
    expect(stringFieldAt(scripts, 'verify:container')).toContain(
      appTemplateVerifyContainerScriptPath,
    )
    expect(templateFileExists(appTemplateVerifyContainerScriptPath)).toBe(true)
  })

  it('depends on the three always-on hearthkit packages plus every optional section at workspace:* and pins its third-party versions', () => {
    const packageJson = readTemplatePackageJson()
    const dependencies = jsonObjectAt(packageJson, 'dependencies')
    const devDependencies = jsonObjectAt(packageJson, 'devDependencies')
    const allDependencies = { ...dependencies, ...devDependencies }

    // Three packages always, plus each optional package's own runtime dependencies and its dev
    // dependencies. Exactly those and no more: a hearthkit package in the manifest that no section
    // claims is one @hearthkit/create would never delete, and so one an empty-selection project
    // would install for nothing.
    const hearthkitDependencyNames = Object.keys(allDependencies)
      .filter((dependencyName) => dependencyName.startsWith('@hearthkit/'))
      .toSorted()
    expect(hearthkitDependencyNames).toEqual(
      [
        ...new Set([
          ...appTemplateRequiredPackageNames,
          ...optionalHearthkitDependencyNames,
          ...optionalDevDependencyNames.filter((dependencyName) =>
            dependencyName.startsWith('@hearthkit/'),
          ),
        ]),
      ].toSorted(),
    )

    // The optional runtime packages are dependencies, and the tools they bring are dev dependencies.
    const misplacedOptionalDependencies = [
      ...optionalHearthkitDependencyNames.filter(
        (dependencyName) => dependencies[dependencyName] === undefined,
      ),
      ...optionalDevDependencyNames.filter(
        (dependencyName) => devDependencies[dependencyName] === undefined,
      ),
    ]
    expect(misplacedOptionalDependencies).toEqual([])

    const wrongSpecifiers = hearthkitDependencyNames.filter(
      (dependencyName) =>
        allDependencies[dependencyName] !== appTemplateWorkspaceDependencySpecifier,
    )
    expect(wrongSpecifiers).toEqual([])

    // The three packages are what the app runs on, so they are dependencies, not dev dependencies.
    const misplacedPackageNames = appTemplateRequiredPackageNames.filter(
      (packageName) => dependencies[packageName] === undefined,
    )
    expect(misplacedPackageNames).toEqual([])

    expect(dependencies.next).toBe(appTemplateNextVersion)
    expect(devDependencies.typescript).toBe(appTemplateTypescriptVersion)

    // React is pinned to the versions @hearthkit/ui develops against, so the app renders the same
    // React the components were built against.
    const uiDevDependencies = jsonObjectAt(readUiPackageJson(), 'devDependencies')
    expect(dependencies.react).toBe(uiDevDependencies.react)
    expect(dependencies['react-dom']).toBe(uiDevDependencies['react-dom'])

    // oxlint runs with the repo's rules, so it runs at the repo's versions too.
    const repoDevDependencies = jsonObjectAt(readRepoRootPackageJson(), 'devDependencies')
    expect(devDependencies.oxlint).toBe(repoDevDependencies.oxlint)
    expect(devDependencies['oxlint-tsgolint']).toBe(repoDevDependencies['oxlint-tsgolint'])

    // Tailwind and its PostCSS plugin move in lockstep, so one constant pins both.
    expect(devDependencies.tailwindcss).toBe(appTemplateTailwindVersion)
    expect(devDependencies['@tailwindcss/postcss']).toBe(appTemplateTailwindVersion)
    expect(devDependencies['@playwright/test']).toBe(appTemplatePlaywrightVersion)

    const missingTypePackages = ['@types/node', '@types/react', '@types/react-dom'].filter(
      (typesPackageName) => devDependencies[typesPackageName] === undefined,
    )
    expect(missingTypePackages).toEqual([])

    // The repo-only dev dependencies exist here and are deleted when the template is scaffolded.
    const missingRepoOnlyDependencies = appTemplateRepoOnlyDependencyNames.filter(
      (dependencyName) => devDependencies[dependencyName] === undefined,
    )
    expect(missingRepoOnlyDependencies).toEqual([])
  })
})
