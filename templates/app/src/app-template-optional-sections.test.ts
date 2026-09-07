import { describe, expect, it } from 'vitest'
import { expectNonEmptyStringList } from '../test-fixtures/app-template-gate-expectations.ts'
import {
  templateFileExists,
  trackedTemplateFilePaths,
} from '../test-fixtures/app-template-tree-files.ts'
import {
  appTemplateEnvVariableNames,
  appTemplateFailureSchema,
  appTemplateGuaranteedPaths,
  appTemplateOptionalPackageNames,
  appTemplateOptionalPackageSectionSchema,
  appTemplateOptionalSelectionIncompleteErrorPrefix,
  appTemplateRepoOnlyDirectoryNames,
  appTemplateRepoOnlyPaths,
  appTemplateSectionsByOptionalPackage,
  appTemplateSupersetEnvVariableNames,
  type AppTemplateOptionalPackageName,
} from './app-template-contract.ts'

/**
 * `appTemplateSectionsByOptionalPackage` is the value @hearthkit/create consumes in Phase 6, so its
 * shape matters more than any individual section. These gates check the map against itself and
 * against the tree; what each section DOES lives in the flows.
 */

/** Every entry in map order, which is the order @hearthkit/create walks when it prunes. */
const sectionEntries = appTemplateOptionalPackageNames.map(
  (optionalPackageName) =>
    [optionalPackageName, appTemplateSectionsByOptionalPackage[optionalPackageName]] as const,
)

/** The one list every package legitimately shares an entry in, which is what proves the union rule is real. */
const sharedDevDependencyName = '@hearthkit/cli'

/** Names appearing more than once in a list, as a sorted list a failure can print. */
function duplicatedNamesIn(names: readonly string[]): string[] {
  const seenOnce = new Set<string>()
  const seenTwice = new Set<string>()
  for (const name of names) {
    if (seenOnce.has(name)) {
      seenTwice.add(name)
    }
    seenOnce.add(name)
  }
  return [...seenTwice].toSorted()
}

/** The packages a selection names without one they require, which is what @hearthkit/create resolves for a user. */
function missingRequiredOptionalPackageNames(
  selectedOptionalPackageNames: readonly AppTemplateOptionalPackageName[],
): AppTemplateOptionalPackageName[] {
  const selected = new Set<string>(selectedOptionalPackageNames)
  return [
    ...new Set(
      selectedOptionalPackageNames.flatMap((optionalPackageName) =>
        appTemplateSectionsByOptionalPackage[
          optionalPackageName
        ].requiredOptionalPackageNames.filter((requiredName) => !selected.has(requiredName)),
      ),
    ),
  ]
}

describe('appTemplateSectionsByOptionalPackage', () => {
  it('parses every entry through appTemplateOptionalPackageSectionSchema and keys the map on every optional package name', () => {
    // The keys are the enum, in the enum's order: a fifth package added to the list and not to the
    // map, or a map entry for a name that is not selectable, is what this catches.
    expect(Object.keys(appTemplateSectionsByOptionalPackage)).toEqual([
      ...appTemplateOptionalPackageNames,
    ])

    for (const [optionalPackageName, section] of sectionEntries) {
      const parsed = appTemplateOptionalPackageSectionSchema.parse(section)
      expect(parsed.sectionRoutePath, `${optionalPackageName} sectionRoutePath`).toBe(
        section.sectionRoutePath,
      )
      // Each list the schema requires to be non-empty is non-empty for a reason: a package with no
      // owned path has no section, and one with no blockPrunedPath cannot reach the boot schema.
      expect(
        section.ownedTemplatePaths.length,
        `${optionalPackageName} ownedTemplatePaths`,
      ).toBeGreaterThan(0)
      expect(
        section.blockPrunedPaths.length,
        `${optionalPackageName} blockPrunedPaths`,
      ).toBeGreaterThan(0)
      expect(
        section.envVariableNames.length,
        `${optionalPackageName} envVariableNames`,
      ).toBeGreaterThan(0)
    }
  })

  it('gives every owned path and every environment variable exactly one owning package, while sharing every other list', () => {
    // Two ownership rules, different on purpose. Pruning must answer "who owns this" with one name,
    // so paths and variables are exclusive.
    const ownedPathOwners = sectionEntries.flatMap(([, section]) => section.ownedTemplatePaths)
    expect(duplicatedNamesIn(ownedPathOwners)).toEqual([])
    expect(
      duplicatedNamesIn(sectionEntries.flatMap(([, section]) => section.envVariableNames)),
    ).toEqual([])

    // An owned path may not also be a path every project gets, or a hearthkit-only one: the first
    // would delete a guaranteed file with a section, the second would ship a gate.
    const ownedPathsThatAreNotOptional = ownedPathOwners.filter(
      (ownedPath) =>
        (appTemplateGuaranteedPaths as readonly string[]).includes(ownedPath) ||
        (appTemplateRepoOnlyPaths as readonly string[]).includes(ownedPath) ||
        expectNonEmptyStringList(
          appTemplateRepoOnlyDirectoryNames,
          'appTemplateRepoOnlyDirectoryNames',
        ).some((directoryName) => ownedPath.startsWith(`${directoryName}/`)),
    )
    expect(ownedPathsThatAreNotOptional).toEqual([])

    // No optional variable may repeat one every project already has, or .env.example would document
    // it twice and one copy would be pruned.
    const optionalVariableNames = sectionEntries.flatMap(([, section]) => section.envVariableNames)
    expect(
      optionalVariableNames.filter((variableName) =>
        (appTemplateEnvVariableNames as readonly string[]).includes(variableName),
      ),
    ).toEqual([])

    // Everything else is unioned and deduplicated across the selected packages, exactly as postgres
    // appears under two packages in the cli map. @hearthkit/cli in all four is that rule in use, and
    // without it this gate would be asserting an exclusivity that does not exist.
    const packagesSharingTheCliDevDependency = sectionEntries.filter(([, section]) =>
      section.devDependencyNames.includes(sharedDevDependencyName),
    )
    expect(packagesSharingTheCliDevDependency.map(([name]) => name)).toEqual([
      ...appTemplateOptionalPackageNames,
    ])
  })

  it('lists in appTemplateSupersetEnvVariableNames the always-on three followed by each package variables in map order', () => {
    // The superset list is written out by hand so a Phase 6 gate can read it directly, which is only
    // safe while something proves it and the map still agree.
    expect([...appTemplateSupersetEnvVariableNames]).toEqual([
      ...appTemplateEnvVariableNames,
      ...sectionEntries.flatMap(([, section]) => section.envVariableNames),
    ])
    expect(duplicatedNamesIn([...appTemplateSupersetEnvVariableNames])).toEqual([])
  })

  it('ships every path it owns in the superset tree, including the one flow spec each section names', () => {
    const trackedPaths = new Set(trackedTemplateFilePaths())
    const missingOwnedPaths: string[] = []

    for (const [optionalPackageName, section] of sectionEntries) {
      // The flow spec is one of the owned paths rather than a path of its own, so pruning a section
      // takes its flow with it and no project keeps a spec for a package it did not select.
      expect(
        section.ownedTemplatePaths,
        `${optionalPackageName} must own its flowSpecPath`,
      ).toContain(section.flowSpecPath)
      expect(section.flowSpecPath.startsWith('e2e/')).toBe(true)
      expect(section.flowSpecPath.endsWith('.spec.ts')).toBe(true)

      // Reported without a contract prefix on purpose: AppTemplateFailure has a variant for an
      // owned path that reached a project it should not have (app-template-optional-section-copied)
      // and one for a missing GUARANTEED path, but none for an owned path missing from the template
      // itself. Tracked as well as present, because an untracked section file is not part of the
      // artifact @hearthkit/create copies.
      for (const ownedPath of section.ownedTemplatePaths) {
        if (!templateFileExists(ownedPath) || !trackedPaths.has(ownedPath)) {
          missingOwnedPaths.push(
            `${optionalPackageName} owns ${ownedPath}, which the template does not ship`,
          )
        }
      }

      // A block-pruned path is either a file every project gets, or a file owned by a package this
      // one requires — which is how @hearthkit/payments holds a block inside two files
      // @hearthkit/auth owns without ever meeting them absent.
      for (const blockPrunedPath of section.blockPrunedPaths) {
        const owningPackageName = sectionEntries.find(([, other]) =>
          (other.ownedTemplatePaths as readonly string[]).includes(blockPrunedPath),
        )?.[0]
        if (owningPackageName === undefined) {
          expect(
            appTemplateGuaranteedPaths as readonly string[],
            `${optionalPackageName} holds a block in ${blockPrunedPath}, which no package owns`,
          ).toContain(blockPrunedPath)
          continue
        }
        expect(
          section.requiredOptionalPackageNames,
          `${optionalPackageName} holds a block in ${blockPrunedPath}, owned by ${owningPackageName}`,
        ).toContain(owningPackageName)
      }
    }

    expect(missingOwnedPaths).toEqual([])
  })

  it('reports app-template-optional-selection-incomplete for a selection missing a package it requires', () => {
    // Every required name is itself selectable, and no package requires itself, or the closure a
    // scaffolder computes would never terminate.
    for (const [optionalPackageName, section] of sectionEntries) {
      expect(section.requiredOptionalPackageNames).not.toContain(optionalPackageName)
      for (const requiredName of section.requiredOptionalPackageNames) {
        expect(appTemplateOptionalPackageNames as readonly string[]).toContain(requiredName)
      }
    }

    // Naming payments without auth is the failure; the full closure is not.
    const incompleteSelection: AppTemplateOptionalPackageName[] = ['@hearthkit/payments']
    const missingOptionalPackageNames = missingRequiredOptionalPackageNames(incompleteSelection)
    expect(missingOptionalPackageNames).toEqual(['@hearthkit/auth'])
    expect(
      missingRequiredOptionalPackageNames([
        '@hearthkit/payments',
        '@hearthkit/auth',
        '@hearthkit/email',
      ]),
    ).toEqual([])

    const selectionIncompleteFailure = appTemplateFailureSchema.parse({
      kind: 'app-template-optional-selection-incomplete',
      selectedOptionalPackageNames: incompleteSelection,
      missingOptionalPackageNames,
      message: `${appTemplateOptionalSelectionIncompleteErrorPrefix} ${incompleteSelection.join(', ')} needs ${missingOptionalPackageNames.join(', ')}`,
    })
    expect(selectionIncompleteFailure.kind).toBe('app-template-optional-selection-incomplete')
  })
})
