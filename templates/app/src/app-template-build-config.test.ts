import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  importTemplateModule,
  jsonObjectAt,
  jsonStringArrayAt,
} from '../test-fixtures/app-template-gate-expectations.ts'
import {
  hearthkitRepoRootPath,
  meaningfulLines,
  readJsonFileAt,
  readTemplateFileText,
  readTemplateJsonFile,
} from '../test-fixtures/app-template-tree-files.ts'
import {
  appNextConfigOutputMode,
  appTemplateNeverCopiedDirectoryNames,
  appTemplateRequiredPackageNames,
} from './app-template-contract.ts'

/** Compiler options tsconfig.json mirrors from tsconfig.base.json; it cannot extend a file a generated project has no copy of. */
const mirroredCompilerOptionNames = [
  'strict',
  'noUncheckedIndexedAccess',
  'noImplicitOverride',
  'verbatimModuleSyntax',
  'isolatedModules',
  'skipLibCheck',
  'forceConsistentCasingInFileNames',
  'resolveJsonModule',
  'types',
  'allowImportingTsExtensions',
  'erasableSyntaxOnly',
]

/** Entries tsconfig include must carry; jsx and the .next/dev/types entry are pre-set so next build does not rewrite the file. */
const requiredTsconfigIncludeEntries = [
  'next-env.d.ts',
  '**/*.ts',
  '**/*.tsx',
  '.next/dev/types/**/*.ts',
]

/** Ignore entries the contract names beyond the never-copied directories, which the gate builds from the constant. */
const additionalGitignoreEntries = [
  'next-env.d.ts',
  '.env',
  '.env.local',
  '*.tsbuildinfo',
  '.DS_Store',
]

const withoutTrailingSlash = (entry: string): string => entry.replace(/\/+$/, '')

describe('templates/app build configuration', () => {
  it('sets standalone output and transpiles every hearthkit package in next.config.ts', async () => {
    const nextConfigModule = await importTemplateModule(
      'next.config.ts',
      () => import('../next.config.ts'),
    )
    const nextConfig = jsonObjectAt(nextConfigModule, 'default')

    // standalone is what writes .next/standalone for the Dockerfile's runner stage.
    expect(nextConfig.output).toBe(appNextConfigOutputMode)

    // The hearthkit packages ship TypeScript source, so Next must compile them.
    const transpiledPackages = jsonStringArrayAt(nextConfig, 'transpilePackages')
    const untranspiledPackageNames = appTemplateRequiredPackageNames.filter(
      (packageName) => !transpiledPackages.includes(packageName),
    )
    expect(untranspiledPackageNames).toEqual([])

    // A package may never appear in both lists; Next throws at build start when it does.
    const serverExternalPackages = jsonStringArrayAt(nextConfig, 'serverExternalPackages')
    expect(serverExternalPackages.filter((name) => transpiledPackages.includes(name))).toEqual([])

    // A generated project is its own tracing root, and useTypeScriptCli is already the default.
    expect(nextConfig.outputFileTracingRoot).toBeUndefined()
    expect(jsonObjectAt(nextConfig, 'experimental').useTypeScriptCli).toBeUndefined()
  })

  it('mirrors tsconfig.base.json in tsconfig.json and adds what Next needs, with no extends and no baseUrl', () => {
    const templateTsconfig = readTemplateJsonFile('tsconfig.json')
    const baseTsconfig = readJsonFileAt(join(hearthkitRepoRootPath, 'tsconfig.base.json'))
    const templateOptions = jsonObjectAt(templateTsconfig, 'compilerOptions')
    const baseOptions = jsonObjectAt(baseTsconfig, 'compilerOptions')

    // A generated project cannot reach ../../tsconfig.base.json, so the file is self-contained and
    // this gate is the only thing that keeps the mirrored options from drifting.
    expect(Object.keys(templateTsconfig)).not.toContain('extends')
    expect(Object.keys(templateOptions)).not.toContain('baseUrl')

    for (const optionName of mirroredCompilerOptionNames) {
      expect(
        baseOptions[optionName],
        `tsconfig.base.json no longer sets ${optionName}`,
      ).toBeDefined()
      expect(templateOptions[optionName], `compilerOptions.${optionName}`).toEqual(
        baseOptions[optionName],
      )
    }

    expect(templateOptions.jsx).toBe('react-jsx')
    expect(templateOptions.module).toBe('preserve')
    expect(templateOptions.moduleResolution).toBe('bundler')
    expect(templateOptions.noEmit).toBe(true)
    expect(jsonStringArrayAt(templateOptions, 'lib')).toContain('DOM')

    const includeEntries = jsonStringArrayAt(templateTsconfig, 'include')
    const missingIncludeEntries = requiredTsconfigIncludeEntries.filter(
      (entry) => !includeEntries.includes(entry),
    )
    expect(missingIncludeEntries).toEqual([])
  })

  it('registers the tailwind plugin and nothing else in postcss.config.mjs', async () => {
    const postcssConfigModule = await importTemplateModule(
      'postcss.config.mjs',
      () => import('../postcss.config.mjs'),
    )
    const postcssConfig = jsonObjectAt(postcssConfigModule, 'default')

    expect(Object.keys(jsonObjectAt(postcssConfig, 'plugins'))).toEqual(['@tailwindcss/postcss'])
  })

  it('ignores dependencies, build output, env files and test artifacts in gitignore', () => {
    const ignoredEntries = meaningfulLines(readTemplateFileText('gitignore'), ['#']).map(
      withoutTrailingSlash,
    )

    const expectedEntries = [
      ...appTemplateNeverCopiedDirectoryNames,
      ...additionalGitignoreEntries,
    ].map(withoutTrailingSlash)

    const missingEntries = expectedEntries.filter((entry) => !ignoredEntries.includes(entry))
    expect(missingEntries).toEqual([])
  })
})
