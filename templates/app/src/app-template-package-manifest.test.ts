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
  appTemplatePackageName,
  appTemplatePlaywrightVersion,
  appTemplateRepoOnlyDependencyNames,
  appTemplateRepoOnlyScriptNames,
  appTemplateRequiredPackageNames,
  appTemplateTailwindVersion,
  appTemplateTypescriptVersion,
  appTemplateVerifyContainerScriptPath,
  appTemplateWorkspaceDependencySpecifier,
} from './app-template-contract.ts'

/** The exact command each shipped script runs, as the contract's script table writes it. */
const expectedScriptCommands: Record<string, string> = {
  dev: 'next dev',
  build: 'next build',
  start: 'next start',
  lint: 'oxlint --type-aware .',
  typecheck: 'next typegen && tsc --noEmit',
  'test:e2e': 'playwright test',
  test: 'vitest run',
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
    ].filter((scriptName) => stringFieldAt(scripts, scriptName) === '')
    expect(missingScriptNames).toEqual([])

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

  it('depends on exactly the three hearthkit packages at workspace:* and pins its third-party versions', () => {
    const packageJson = readTemplatePackageJson()
    const dependencies = jsonObjectAt(packageJson, 'dependencies')
    const devDependencies = jsonObjectAt(packageJson, 'devDependencies')
    const allDependencies = { ...dependencies, ...devDependencies }

    // Phase 4 wires three packages and no more: no db, storage, email, auth, payments or cli.
    const hearthkitDependencyNames = Object.keys(allDependencies)
      .filter((dependencyName) => dependencyName.startsWith('@hearthkit/'))
      .toSorted()
    expect(hearthkitDependencyNames).toEqual([...appTemplateRequiredPackageNames].toSorted())

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
