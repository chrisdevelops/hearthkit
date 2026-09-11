import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  generateLocalInfraCompose,
  hearthkitProjectNameSchema,
  localInfraServiceNameSchema,
  type LocalInfraServiceName,
} from '@hearthkit/cli'
import type { ResolvedHearthkitPackageName } from './create-contract.ts'

/**
 * The two files a generated project needs that the template does not carry.
 *
 * `docker-compose.yml` comes from the CLI's own generator rather than from a copied template, so the
 * file `hearthkit dev infra up` regenerates and the file create writes cannot drift. `.env.example`
 * and the `Dockerfile` are NOT here: both are guaranteed template paths and arrive as pruned copies.
 */

/** Which local infra service each resolved package pulls in; db and auth both mean postgres, which the CLI's own map already says. */
const infraServicesByResolvedPackage = {
  db: ['postgres'],
  storage: ['minio'],
  email: ['mailpit'],
  auth: [],
  payments: [],
} as const satisfies Record<ResolvedHearthkitPackageName, readonly LocalInfraServiceName[]>

/** Path of the OpenTofu variables file, relative to the project; the operator fills in the four placeholders before hearthkit infra apply. */
export const generatedTofuVariablesPath = 'infra/tofu.tfvars'

/** The four inputs create cannot know, each written blank with the one line saying where its value comes from; hearthkit infra apply refuses to run while any is blank. */
const tofuVariablePlaceholderComments = [
  [
    'zone_name',
    'apex name of the Cloudflare zone this project lives under, for example example.com',
  ],
  ['zone_id', 'zone id from the Cloudflare dashboard overview page'],
  ['account_id', 'account id from the Cloudflare dashboard'],
  ['host_ip', 'IPv4 address of the VPS this project is deployed to'],
] as const

/** The exact text of a project's infra/tofu.tfvars: the project name filled in, the four inputs create cannot know left blank under a comment each. */
function buildTofuVariablesFileText(projectName: string): string {
  const placeholderLines = tofuVariablePlaceholderComments.flatMap(([variableName, comment]) => [
    `# ${comment}`,
    `${variableName} = ""`,
  ])
  return `${['# Inputs of the hearthkit OpenTofu provider module, read by hearthkit infra apply.', `project_name = "${projectName}"`, ...placeholderLines].join('\n')}\n`
}

/** Path of the generated compose file, relative to the project; absent when no package needs a local service. */
export const generatedComposeFilePath = 'docker-compose.yml'

/** The local infra services a resolved package set needs, deduplicated and in the CLI's fixed service order. */
export function deriveInfraServicesFor(
  resolvedPackages: readonly ResolvedHearthkitPackageName[],
): LocalInfraServiceName[] {
  const needed = new Set(
    resolvedPackages.flatMap((resolvedPackage) => [
      ...infraServicesByResolvedPackage[resolvedPackage],
    ]),
  )
  return localInfraServiceNameSchema.options.filter((serviceName) => needed.has(serviceName))
}

/** Writes the compose file and the tfvars file, and answers the generated-project paths it wrote. */
export async function writeGeneratedProjectFiles(options: {
  projectDirectoryPath: string
  projectName: string
  resolvedPackages: readonly ResolvedHearthkitPackageName[]
}): Promise<string[]> {
  const writtenProjectPaths: string[] = []
  const hearthkitProjectName = hearthkitProjectNameSchema.parse(options.projectName)

  const infraServices = deriveInfraServicesFor(options.resolvedPackages)
  if (infraServices.length > 0) {
    await writeFile(
      join(options.projectDirectoryPath, generatedComposeFilePath),
      generateLocalInfraCompose({ hearthkitProjectName, infraServices }),
      'utf8',
    )
    writtenProjectPaths.push(generatedComposeFilePath)
  }

  await mkdir(join(options.projectDirectoryPath, 'infra'), { recursive: true })
  await writeFile(
    join(options.projectDirectoryPath, ...generatedTofuVariablesPath.split('/')),
    buildTofuVariablesFileText(String(hearthkitProjectName)),
    'utf8',
  )
  writtenProjectPaths.push(generatedTofuVariablesPath)

  return writtenProjectPaths
}
