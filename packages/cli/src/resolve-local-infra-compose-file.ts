import { access, writeFile } from 'node:fs/promises'
import { constants as fileSystemConstants } from 'node:fs'
import { join } from 'node:path'
import type { CliFailure } from './cli-contract.js'
import {
  composeFileUnwritableFailure,
  projectManifestMissingFailure,
} from './cli-failure-results.js'
import type { CliRuntimeContext } from './cli-runtime-context.js'
import { generateLocalInfraCompose } from './generate-local-infra-compose.js'
import { readProjectInfraManifest } from './read-project-infra-manifest.js'

/** The one compose file name this package reads and, when it is absent, writes. */
const localInfraComposeFileName = 'docker-compose.yml'

/** Which compose file to run, that none is needed, or why one could not be produced. */
export type LocalInfraComposeResolution =
  | { kind: 'local-infra-compose-ready'; composeFilePath: string }
  | { kind: 'local-infra-compose-not-needed' }
  | { kind: 'local-infra-compose-rejected'; failure: CliFailure }

/** Where the working directory's compose file lives, whether or not it exists yet. */
export function localInfraComposeFilePath(context: CliRuntimeContext): string {
  return join(context.workingDirectoryPath, localInfraComposeFileName)
}

/** True when the working directory already holds a compose file, which dev infra down needs to know before touching docker. */
export async function hasLocalInfraComposeFile(context: CliRuntimeContext): Promise<boolean> {
  try {
    await access(localInfraComposeFilePath(context), fileSystemConstants.F_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Answers which compose file dev infra up should run. An existing file is used exactly as written
 * and never overwritten; otherwise the project's manifest decides which services are needed and the
 * file is generated. A project needing no local infra is a success with nothing written.
 */
export async function resolveLocalInfraComposeFile(
  context: CliRuntimeContext,
): Promise<LocalInfraComposeResolution> {
  const composeFilePath = localInfraComposeFilePath(context)
  if (await hasLocalInfraComposeFile(context)) {
    return { kind: 'local-infra-compose-ready', composeFilePath }
  }

  const manifest = await readProjectInfraManifest(context)
  if (manifest.kind === 'project-infra-manifest-unreadable') {
    return {
      kind: 'local-infra-compose-rejected',
      failure: projectManifestMissingFailure(manifest.manifestPath, manifest.detail),
    }
  }

  if (manifest.infraServices.length === 0) {
    return { kind: 'local-infra-compose-not-needed' }
  }

  const composeFileContent = generateLocalInfraCompose({
    hearthkitProjectName: manifest.hearthkitProjectName,
    infraServices: manifest.infraServices,
  })

  try {
    await writeFile(composeFilePath, composeFileContent, 'utf8')
  } catch (error) {
    return {
      kind: 'local-infra-compose-rejected',
      failure: composeFileUnwritableFailure(
        composeFilePath,
        `could not be written (${error instanceof Error ? error.message : String(error)})`,
      ),
    }
  }

  return { kind: 'local-infra-compose-ready', composeFilePath }
}
