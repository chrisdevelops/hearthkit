import { describe, expect, it } from 'vitest'
import { expectNonEmptyStringList } from '../test-fixtures/app-template-gate-expectations.ts'
import {
  importSpecifiersInText,
  listTemplateFilePaths,
  readTemplateFileText,
  resolveTemplateRelativeSpecifier,
  templateFileExists,
} from '../test-fixtures/app-template-tree-files.ts'
import {
  appGeneratedProjectGuaranteedPaths,
  appHealthRoutePath,
  appHomeRoutePath,
  appSmokeBaseUrlEnvVariableName,
  appSmokeDefaultBaseUrl,
  appTemplateFailureSchema,
  appTemplateGuaranteedPaths,
  appTemplateNeverCopiedDirectoryNames,
  appTemplatePathMissingErrorPrefix,
  appTemplateRelativePathSchema,
  appTemplateRenamedPaths,
  appTemplateRepoOnlyDirectoryNames,
  appTemplateRepoOnlyPaths,
} from './app-template-contract.ts'

/** Extensions the invariant scan reads; markdown, YAML and the Dockerfile carry no module specifiers. */
const scannedFileExtensions = ['.ts', '.tsx', '.mjs', '.cjs', '.js', '.jsx', '.css']

const isScannedFile = (templateRelativePath: string): boolean =>
  scannedFileExtensions.some((extension) => templateRelativePath.endsWith(extension))

/**
 * True when a path is the repo-only directory itself or sits inside it. Reads the contract list
 * through expectNonEmptyStringList on every call, because this predicate decides what the invariant
 * gate skips: if the contract export were renamed again, a silent undefined here would make the
 * whole scan vacuous instead of failing.
 */
const isUnderRepoOnlyDirectory = (templateRelativePath: string): boolean =>
  expectNonEmptyStringList(
    appTemplateRepoOnlyDirectoryNames,
    'appTemplateRepoOnlyDirectoryNames',
  ).some(
    (directoryName) =>
      templateRelativePath === directoryName ||
      templateRelativePath.startsWith(`${directoryName}/`),
  )

describe('the templates/app tree', () => {
  it('contains every path in appTemplateGuaranteedPaths', () => {
    const missingPaths = appTemplateGuaranteedPaths.filter(
      (guaranteedPath) => !templateFileExists(guaranteedPath),
    )

    // Reported with the contract's own prefix, so a failing run reads like the failure it models.
    expect(
      missingPaths.map((missingPath) => `${appTemplatePathMissingErrorPrefix} ${missingPath}`),
    ).toEqual([])

    // Every literal in the list must be a legal AppTemplateRelativePath, or @hearthkit/create
    // cannot carry it through the branded schema when it copies the tree.
    const unparseablePaths = appTemplateGuaranteedPaths.filter(
      (guaranteedPath) => !appTemplateRelativePathSchema.safeParse(guaranteedPath).success,
    )
    expect(unparseablePaths).toEqual([])

    const pathMissingFailure = appTemplateFailureSchema.parse({
      kind: 'app-template-path-missing',
      missingPath: 'app/page.tsx',
      message: `${appTemplatePathMissingErrorPrefix} app/page.tsx`,
    })
    expect(pathMissingFailure.kind).toBe('app-template-path-missing')
  })

  it('keeps every hearthkit-only file out of the paths a generated project gets', () => {
    // Nothing the scaffolder copies may live in a repo-only directory, in the repo-only file list,
    // or in a directory that is never copied at all. Both contract lists are widened to string
    // first: as literal unions they provably do not overlap today, so tsc rejects the comparison
    // (TS2367), but the runtime question is the one this gate asks, and a later contract edit could
    // legitimately put one of those names into the guaranteed list.
    const shippedButRepoOnly = appTemplateGuaranteedPaths.filter(
      (guaranteedPath) =>
        isUnderRepoOnlyDirectory(guaranteedPath) ||
        (appTemplateRepoOnlyPaths as readonly string[]).includes(guaranteedPath) ||
        (appTemplateNeverCopiedDirectoryNames as readonly string[]).some(
          (directoryName) =>
            guaranteedPath === directoryName || guaranteedPath.startsWith(`${directoryName}/`),
        ),
    )
    expect(shippedButRepoOnly).toEqual([])

    // The repo-only files exist here, which is what makes pruning a real step rather than a no-op.
    // test-fixtures/ is deliberately not required: the contract lets that directory be absent.
    const missingRepoOnlyPaths = [
      ...appTemplateRepoOnlyPaths,
      `${appTemplateRepoOnlyDirectoryNames[0]}/app-template-contract.ts`,
    ].filter((repoOnlyPath) => !templateFileExists(repoOnlyPath))
    expect(missingRepoOnlyPaths).toEqual([])

    // The ignore file is stored dotless here and written dotted into a generated project, because
    // npm strips a nested .gitignore from a published tarball.
    const missingRenameSources = appTemplateRenamedPaths.filter(
      (rename) => !templateFileExists(rename.templatePath),
    )
    expect(missingRenameSources).toEqual([])

    // appGeneratedProjectGuaranteedPaths is written out by hand rather than derived, so that a
    // Phase 6 gate can read it directly. This is the check that keeps the two lists in step.
    const expectedGeneratedProjectPaths = appTemplateGuaranteedPaths
      .map(
        (templatePath) =>
          appTemplateRenamedPaths.find((rename) => rename.templatePath === templatePath)
            ?.generatedProjectPath ?? templatePath,
      )
      .toSorted()
    expect([...appGeneratedProjectGuaranteedPaths]).toEqual(expectedGeneratedProjectPaths)
  })

  it('has no file outside the repo-only directories that imports from them, which is what makes pruning safe', () => {
    const templateFilePaths = listTemplateFilePaths({
      skipDirectoryNames: [...appTemplateNeverCopiedDirectoryNames, '.git'],
    })

    // The invariant is only worth anything once the shipped code files exist, so the gate asserts
    // they are all present and scanned before it asserts what they may import.
    const shippedCodePaths = appTemplateGuaranteedPaths.filter(
      (guaranteedPath) =>
        isScannedFile(guaranteedPath) && !isUnderRepoOnlyDirectory(guaranteedPath),
    )
    const unscannedShippedCodePaths = shippedCodePaths.filter(
      (shippedCodePath) => !templateFilePaths.includes(shippedCodePath),
    )
    expect(unscannedShippedCodePaths).toEqual([])

    const importsFromRepoOnlyDirectory: string[] = []
    for (const templateFilePath of templateFilePaths) {
      if (isUnderRepoOnlyDirectory(templateFilePath) || !isScannedFile(templateFilePath)) {
        continue
      }
      for (const specifier of importSpecifiersInText(readTemplateFileText(templateFilePath))) {
        const resolvedSpecifier = specifier.startsWith('.')
          ? resolveTemplateRelativeSpecifier(templateFilePath, specifier)
          : specifier
        if (isUnderRepoOnlyDirectory(resolvedSpecifier)) {
          importsFromRepoOnlyDirectory.push(`${templateFilePath} imports ${specifier}`)
        }
      }
    }
    expect(importsFromRepoOnlyDirectory).toEqual([])
  })

  it('ships a smoke test that repeats the contract routes as literals because it cannot import src/', () => {
    // e2e/app-smoke.spec.ts and playwright.config.ts are project deliverables, so they may not read
    // the contract. This gate is the only thing keeping their literals and the contract in step.
    const smokeSpecText = readTemplateFileText('e2e/app-smoke.spec.ts')
    expect(smokeSpecText).toContain(`'${appHomeRoutePath}'`)
    expect(smokeSpecText).toContain(`'${appHealthRoutePath}'`)

    const playwrightConfigText = readTemplateFileText('playwright.config.ts')
    expect(playwrightConfigText).toContain(appSmokeBaseUrlEnvVariableName)
    expect(playwrightConfigText).toContain(appSmokeDefaultBaseUrl)

    // Both routes the smoke test loads must be routes the template actually serves.
    expect(templateFileExists('app/page.tsx')).toBe(true)
    expect(templateFileExists(`app${appHealthRoutePath}/route.ts`)).toBe(true)
  })
})
