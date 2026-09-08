import { localInfraServiceNameSchema, type LocalInfraServiceName } from '../src/cli-contract.ts'

/**
 * The package-to-service map as the public entry point hands it out: one-to-many, because
 * @hearthkit/auth pulls in two services and a singular value could not say so.
 */
export type LocalInfraServicesByHearthkitPackage = Readonly<
  Record<string, readonly LocalInfraServiceName[]>
>

/** True when a value is a non-empty list of names localInfraServiceNameSchema accepts, which is what one-to-many means here. */
function isLocalInfraServiceNameList(value: unknown): value is readonly LocalInfraServiceName[] {
  const serviceNames = localInfraServiceNameSchema.options as readonly string[]
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => typeof entry === 'string' && serviceNames.includes(entry))
  )
}

/**
 * Loads localInfraServicesByHearthkitPackage through the public entry point and refuses to hand back
 * anything that is not a one-to-many map. Two things make the check necessary. The export is public
 * API and was renamed from the singular localInfraServiceByHearthkitPackage, so the name is part of
 * what a gate holds. And this repo's Vitest resolves an absent named export to undefined instead of
 * throwing, so without this check a gate could read undefined and go green while asserting nothing.
 */
export async function loadHearthkitCliInfraServiceMap(): Promise<LocalInfraServicesByHearthkitPackage> {
  let loaded: unknown
  try {
    loaded = await import('@hearthkit/cli')
  } catch (error) {
    throw new Error(
      `gate could not load the public entry point of @hearthkit/cli (not implemented yet?): ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }

  const exportedMap = (loaded as Record<string, unknown>).localInfraServicesByHearthkitPackage
  if (typeof exportedMap !== 'object' || exportedMap === null) {
    throw new Error(
      'gate expected @hearthkit/cli to export localInfraServicesByHearthkitPackage as an object mapping each hearthkit package name to the list of local infra services it pulls in',
    )
  }

  const entries = Object.entries(exportedMap as Record<string, unknown>)
  const packageNamesWithoutAServiceList = entries
    .filter(([, serviceNames]) => !isLocalInfraServiceNameList(serviceNames))
    .map(([packageName]) => packageName)
  if (entries.length === 0 || packageNamesWithoutAServiceList.length > 0) {
    throw new Error(
      `gate expected every value of localInfraServicesByHearthkitPackage to be a non-empty list of local infra service names, which is not true of ${packageNamesWithoutAServiceList.join(', ') || '(the map is empty)'}`,
    )
  }

  return exportedMap as LocalInfraServicesByHearthkitPackage
}
