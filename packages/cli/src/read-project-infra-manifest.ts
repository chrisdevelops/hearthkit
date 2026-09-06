import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import {
  localInfraServiceNameSchema,
  localInfraServicesByHearthkitPackage,
  type HearthkitProjectName,
  type LocalInfraServiceName,
} from './cli-contract.ts'
import type { CliRuntimeContext } from './cli-runtime-context.ts'
import { deriveHearthkitProjectName } from './derive-hearthkit-project-name.ts'

/** The only fields of a project's package.json this package looks at; anything else is ignored, not rejected. */
const projectManifestSchema = z.object({
  name: z.string().optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
})

/** What the working directory's package.json said, or why it could not be used as a manifest. */
export type ProjectInfraManifestOutcome =
  | {
      kind: 'project-infra-manifest-read'
      manifestPath: string
      hearthkitProjectName: HearthkitProjectName
      infraServices: LocalInfraServiceName[]
    }
  | { kind: 'project-infra-manifest-unreadable'; manifestPath: string; detail: string }

/**
 * Reads ./package.json and answers which local infra services the installed hearthkit packages ask
 * for. A manifest that is absent, unreadable, or not an object is one outcome: there is nothing to
 * derive services from either way, and the caller reports it as project-manifest-missing.
 */
export async function readProjectInfraManifest(
  context: CliRuntimeContext,
): Promise<ProjectInfraManifestOutcome> {
  const manifestPath = join(context.workingDirectoryPath, 'package.json')

  let manifestFileContent: string
  try {
    manifestFileContent = await readFile(manifestPath, 'utf8')
  } catch (error) {
    return {
      kind: 'project-infra-manifest-unreadable',
      manifestPath,
      detail: `could not be read (${error instanceof Error ? error.message : String(error)})`,
    }
  }

  let manifestValue: unknown
  try {
    manifestValue = JSON.parse(manifestFileContent)
  } catch (error) {
    return {
      kind: 'project-infra-manifest-unreadable',
      manifestPath,
      detail: `is not valid json (${error instanceof Error ? error.message : String(error)})`,
    }
  }

  const parsedManifest = projectManifestSchema.safeParse(manifestValue)
  if (!parsedManifest.success) {
    return {
      kind: 'project-infra-manifest-unreadable',
      manifestPath,
      detail: 'is not a package manifest with name and dependency fields',
    }
  }

  return {
    kind: 'project-infra-manifest-read',
    manifestPath,
    hearthkitProjectName: deriveHearthkitProjectName(parsedManifest.data.name),
    infraServices: readInfraServicesFromDependencies({
      ...parsedManifest.data.dependencies,
      ...parsedManifest.data.devDependencies,
    }),
  }
}

/**
 * Maps installed hearthkit packages to the services they need. The map is one-to-many, so two
 * packages can name the same service and the Set collapses it to one. The returned order comes from
 * localInfraServiceNameSchema.options and never from the map or the manifest, which is what keeps one
 * manifest producing one compose file.
 */
function readInfraServicesFromDependencies(
  dependencyVersionByName: Record<string, string>,
): LocalInfraServiceName[] {
  const neededServiceNames = new Set<LocalInfraServiceName>(
    Object.entries(localInfraServicesByHearthkitPackage)
      .filter(([packageName]) => dependencyVersionByName[packageName] !== undefined)
      .flatMap(([, serviceNames]) => serviceNames),
  )
  return localInfraServiceNameSchema.options.filter((serviceName) =>
    neededServiceNames.has(serviceName),
  )
}
