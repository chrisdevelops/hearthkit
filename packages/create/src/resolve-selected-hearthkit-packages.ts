import {
  createOptionalPackageNameSchema,
  resolvedHearthkitPackageNameSchema,
  type ResolvedHearthkitPackageName,
} from './create-contract.ts'

/**
 * Turns the bare package names a user chose into the set a generated project actually gets.
 *
 * Nobody selects `db`: `auth` needs it and `payments` needs `auth`, so it arrives by resolution or
 * not at all. Naming it is therefore always a mistake and comes back as an unknown package.
 */

/** Everything one selectable package pulls in, itself included; the closure is written out so a reader sees it without following edges. */
const resolvedPackagesByOptionalPackageName = {
  storage: ['storage'],
  email: ['email'],
  auth: ['db', 'email', 'auth'],
  payments: ['db', 'email', 'auth', 'payments'],
} as const satisfies Record<string, readonly ResolvedHearthkitPackageName[]>

/** What a selection resolved to, or every name in it that is not a selectable package. */
export type SelectedHearthkitPackageResolution =
  | {
      kind: 'hearthkit-packages-resolved'
      resolvedPackages: ResolvedHearthkitPackageName[]
      selectedSectionPackageNames: string[]
    }
  | { kind: 'hearthkit-packages-unknown'; unknownPackageNames: string[] }

/** The scoped template-section name of one resolved package, which is what the manifest keys its sections by. */
function sectionPackageNameOf(resolvedPackage: ResolvedHearthkitPackageName): string {
  return `@hearthkit/${resolvedPackage}`
}

/** Validates every selected name, then resolves the closure and reports it in resolvedHearthkitPackageNameSchema order. */
export function resolveSelectedHearthkitPackages(
  selectedPackageNames: readonly string[],
): SelectedHearthkitPackageResolution {
  const unknownPackageNames = selectedPackageNames.filter(
    (packageName) => !createOptionalPackageNameSchema.safeParse(packageName).success,
  )
  if (unknownPackageNames.length > 0) {
    return { kind: 'hearthkit-packages-unknown', unknownPackageNames }
  }

  const resolvedPackageNames = new Set<ResolvedHearthkitPackageName>()
  for (const packageName of selectedPackageNames) {
    for (const resolvedPackage of resolvedPackagesByOptionalPackageName[
      createOptionalPackageNameSchema.parse(packageName)
    ]) {
      resolvedPackageNames.add(resolvedPackage)
    }
  }

  const resolvedPackages = resolvedHearthkitPackageNameSchema.options.filter((resolvedPackage) =>
    resolvedPackageNames.has(resolvedPackage),
  )
  return {
    kind: 'hearthkit-packages-resolved',
    resolvedPackages,
    // The template selection is the resolved set minus db, because db owns no template section: its
    // files and blocks belong to auth, which is the only thing that pulls it in.
    selectedSectionPackageNames: resolvedPackages
      .filter((resolvedPackage) => resolvedPackage !== 'db')
      .map(sectionPackageNameOf),
  }
}
