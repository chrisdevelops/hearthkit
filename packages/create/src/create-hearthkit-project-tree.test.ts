import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  createGateDirectory,
  expectHearthkitProjectCreated,
  listProjectFilePaths,
  loadHearthkitCreateEntry,
  manifestSectionOf,
  readProjectFileText,
  readProjectManifest,
  removeGateDirectory,
  uniqueGateProjectName,
} from '../test-fixtures/create-gate-project-directories.ts'
import {
  appGeneratedProjectGuaranteedPaths,
  appTemplateDirectoryPath,
  appTemplateEnvVariableNames,
  appTemplateOptionalPackageNames,
  appTemplateRepoOnlyDirectoryNames,
  appTemplateRepoOnlyPaths,
  appTemplateSectionBlockBeginPrefix,
  appTemplateSectionBlockEndPrefix,
  appTemplateSectionsByOptionalPackage,
  appTemplateWorkspaceDependencySpecifier,
  documentedEnvVariableNamesIn,
} from '../test-fixtures/create-gate-template-manifest.ts'

/**
 * The tree create writes, with `install: false` and `startInfra: false` so these gates are pure:
 * no registry, no Docker, no Stripe. What they prove is the whole of steps 3 to 5 — which paths
 * survive, which blocks survive, which manifest entries survive, and what the two generated files
 * say — for the three selections plan 4.10 names, plus the specifier rewrite that decides whether a
 * generated project can install at all.
 *
 * `templateDirectoryPath` points at the live `templates/app` in every gate, because a bundled copy
 * inside the package is only as current as the last `prepack`, and drift between the template and
 * what create ships is exactly what these gates exist to catch.
 */

const gateDirectoriesToRemove: string[] = []

afterAll(async () => {
  for (const directoryPath of gateDirectoriesToRemove) {
    await removeGateDirectory(directoryPath)
  }
})

/** One scaffold run: fresh directory, explicit selection, nothing installed and nothing started. */
async function scaffoldForGate(options: {
  purpose: string
  packages: string[]
  organizations?: boolean
  packageVersion?: string
}) {
  const entry = await loadHearthkitCreateEntry()
  const gateDirectoryPath = await createGateDirectory(options.purpose)
  gateDirectoriesToRemove.push(gateDirectoryPath)

  return expectHearthkitProjectCreated(
    entry,
    await entry.createHearthkitProject({
      projectName: uniqueGateProjectName(options.purpose),
      packages: options.packages,
      organizations: options.organizations ?? false,
      targetDirectory: join(gateDirectoryPath, 'project'),
      install: false,
      startInfra: false,
      packageVersion: options.packageVersion,
      interactive: false,
      templateDirectoryPath: appTemplateDirectoryPath,
    }),
  )
}

/** Every file in the project that still carries either marker prefix, which no generated project may. */
async function pathsCarryingSectionMarkers(
  projectDirectoryPath: string,
  writtenPaths: readonly string[],
): Promise<string[]> {
  const carrying: string[] = []
  for (const writtenPath of writtenPaths) {
    const fileText = await readProjectFileText(projectDirectoryPath, writtenPath)
    if (
      fileText.includes(appTemplateSectionBlockBeginPrefix) ||
      fileText.includes(appTemplateSectionBlockEndPrefix)
    ) {
      carrying.push(writtenPath)
    }
  }
  return carrying
}

describe('the tree createHearthkitProject writes', () => {
  it('writes exactly the guaranteed project plus infra/tofu.tfvars when the selection is empty', async () => {
    const created = await scaffoldForGate({ purpose: 'empty', packages: [] })
    const { projectDirectoryPath } = created

    expect(created.resolvedPackages).toEqual([])
    expect(created.organizationsEnabled).toBe(false)
    expect(created.commandsRun).toEqual([])

    // Exactly, sorted, and the same set the directory actually holds. Three separate mistakes:
    // reporting a path that was not written, writing a path that was not reported, and reporting the
    // right set in the order the walk happened to visit it.
    const expectedPaths = [...appGeneratedProjectGuaranteedPaths, 'infra/tofu.tfvars'].toSorted()
    expect(created.writtenPaths).toEqual(expectedPaths)
    expect(created.writtenPaths).toEqual(
      [...created.writtenPaths].toSorted((left: string, right: string) =>
        left < right ? -1 : left > right ? 1 : 0,
      ),
    )
    expect(await listProjectFilePaths(projectDirectoryPath)).toEqual(expectedPaths)

    // No marker text anywhere, and no import of a package this project does not depend on. A
    // surviving marker leaves a project that still runs, so nothing else would ever catch it.
    expect(await pathsCarryingSectionMarkers(projectDirectoryPath, created.writtenPaths)).toEqual(
      [],
    )
    expect(manifestSectionOf(await readProjectManifest(projectDirectoryPath), 'scripts').dev).toBe(
      'next dev',
    )

    // .env.example documents the always-on variables and nothing else, which is why an
    // empty-selection project boots on an empty environment.
    const envExampleText = await readProjectFileText(projectDirectoryPath, '.env.example')
    expect(documentedEnvVariableNamesIn(envExampleText).toSorted()).toEqual(
      [...appTemplateEnvVariableNames].toSorted(),
    )
    for (const optionalPackageName of appTemplateOptionalPackageNames) {
      for (const envVariableName of appTemplateSectionsByOptionalPackage[optionalPackageName]
        .envVariableNames) {
        expect(envExampleText, `${envVariableName} (${optionalPackageName})`).not.toContain(
          envVariableName,
        )
      }
    }

    // Five assignments: the project name filled in, and the four inputs create cannot know left
    // blank under a one-line comment each, which is what hearthkit infra apply refuses to run on.
    // The file is pinned line by line, in order, so nothing else can appear in it. Comment prose is
    // normalised to `#` rather than quoted: the contract fixes that a comment is there and says
    // where the value comes from, not the words it uses.
    const tfvarsText = await readProjectFileText(projectDirectoryPath, 'infra/tofu.tfvars')
    const tfvarsLinesWithCommentProseNormalised = tfvarsText
      .split('\n')
      .map((line) => (line.startsWith('# ') && line.trim().length > 2 ? '#' : line))
    expect(tfvarsLinesWithCommentProseNormalised).toEqual([
      '#',
      `project_name = "${created.projectName}"`,
      '#',
      'zone_name = ""',
      '#',
      'zone_id = ""',
      '#',
      'account_id = ""',
      '#',
      'host_ip = ""',
      // The file ends with a newline and nothing after it.
      '',
    ])
  })

  it('keeps every section and derives all three infra services when every package is selected', async () => {
    const created = await scaffoldForGate({
      purpose: 'every',
      packages: ['storage', 'email', 'auth', 'payments'],
    })
    const { projectDirectoryPath } = created

    // Reported in resolvedHearthkitPackageNameSchema order, with db pulled in by auth.
    expect(created.resolvedPackages).toEqual(['db', 'storage', 'email', 'auth', 'payments'])

    const missingSectionPaths = appTemplateOptionalPackageNames.flatMap((optionalPackageName) =>
      appTemplateSectionsByOptionalPackage[optionalPackageName].ownedTemplatePaths.filter(
        (ownedTemplatePath) => !created.writtenPaths.includes(ownedTemplatePath),
      ),
    )
    expect(missingSectionPaths).toEqual([])
    expect(created.writtenPaths).toEqual(
      expect.arrayContaining([...appGeneratedProjectGuaranteedPaths]),
    )

    // The superset still carries no marker and no hearthkit-only file: `src/`, `test-fixtures/`,
    // CONTRACT.md and vitest.config.mts belong to the repo, not to a project.
    expect(await pathsCarryingSectionMarkers(projectDirectoryPath, created.writtenPaths)).toEqual(
      [],
    )
    const repoOnlyPathsCopied = created.writtenPaths.filter(
      (writtenPath) =>
        (appTemplateRepoOnlyPaths as readonly string[]).includes(writtenPath) ||
        appTemplateRepoOnlyDirectoryNames.some((directoryName) =>
          writtenPath.startsWith(`${directoryName}/`),
        ),
    )
    expect(repoOnlyPathsCopied).toEqual([])

    expect(manifestSectionOf(await readProjectManifest(projectDirectoryPath), 'scripts').dev).toBe(
      'hearthkit dev',
    )

    // db gives postgres, storage gives minio, email gives mailpit; all three, in one file, named.
    const composeText = await readProjectFileText(projectDirectoryPath, 'docker-compose.yml')
    for (const infraServiceName of ['postgres', 'minio', 'mailpit']) {
      expect(composeText, `docker-compose.yml must define ${infraServiceName}`).toContain(
        `  ${infraServiceName}:`,
      )
    }
    expect(composeText).toContain(created.projectName)
  })

  it('resolves auth to db, email and auth, and flips appOrganizationsEnabled to true', async () => {
    const created = await scaffoldForGate({
      purpose: 'auth-orgs',
      packages: ['auth'],
      organizations: true,
    })
    const { projectDirectoryPath } = created

    expect(created.resolvedPackages).toEqual(['db', 'email', 'auth'])
    expect(created.organizationsEnabled).toBe(true)

    // The one source line create is ever allowed to rewrite, and it must read as a literal `true`
    // because app-payments-client.ts branches on it at build time.
    const authServerText = await readProjectFileText(projectDirectoryPath, 'app-auth-server.ts')
    expect(authServerText).toContain('export const appOrganizationsEnabled = true')
    expect(authServerText).not.toContain('export const appOrganizationsEnabled = false')

    // auth pulls email in, so mailpit is derived even though nobody selected email; nothing pulls
    // storage in, so minio must not appear.
    const composeText = await readProjectFileText(projectDirectoryPath, 'docker-compose.yml')
    expect(composeText).toContain('  postgres:')
    expect(composeText).toContain('  mailpit:')
    expect(composeText).not.toContain('  minio:')

    // The sections nobody selected are gone, files and manifest entries alike.
    const unselectedPaths = (['@hearthkit/storage', '@hearthkit/payments'] as const).flatMap(
      (optionalPackageName) =>
        appTemplateSectionsByOptionalPackage[optionalPackageName].ownedTemplatePaths.filter(
          (ownedTemplatePath) => created.writtenPaths.includes(ownedTemplatePath),
        ),
    )
    expect(unselectedPaths).toEqual([])
  })

  it('writes packageVersion verbatim into every @hearthkit specifier and leaves no workspace or repo-only entry behind', async () => {
    const packageVersion = 'file:./hearthkit-packages/hearthkit-gate-0.0.0.tgz'
    const created = await scaffoldForGate({
      purpose: 'specifier',
      packages: ['auth'],
      packageVersion,
    })
    const { projectDirectoryPath } = created

    const manifest = await readProjectManifest(projectDirectoryPath)
    const dependencies = manifestSectionOf(manifest, 'dependencies')
    const devDependencies = manifestSectionOf(manifest, 'devDependencies')
    const scripts = manifestSectionOf(manifest, 'scripts')

    expect(manifest.name).toBe(created.projectName)

    // Verbatim, in both dependency maps: a file: specifier is what a scaffold gate installs from,
    // and a version range is what a user gets, so the write cannot interpret what it was handed.
    const hearthkitSpecifiers = [
      ...Object.entries(dependencies),
      ...Object.entries(devDependencies),
    ].filter(([dependencyName]) => dependencyName.startsWith('@hearthkit/'))
    expect(hearthkitSpecifiers.length).toBeGreaterThan(0)
    expect(hearthkitSpecifiers.filter(([, specifier]) => specifier !== packageVersion)).toEqual([])

    // A surviving workspace specifier resolves to nothing outside this repo, which is the failure
    // that turns a scaffolded project into an install error on someone else's machine.
    const manifestText = await readProjectFileText(projectDirectoryPath, 'package.json')
    expect(manifestText).not.toContain(appTemplateWorkspaceDependencySpecifier)

    // The repo's own scripts and dev dependencies go with it; a project has no verify:container.
    expect(scripts['verify:container']).toBeUndefined()
    expect(scripts.test).toBeUndefined()
    expect(devDependencies.vitest).toBeUndefined()

    // And so do the sections nobody selected: payments is not a dependency of an auth-only project.
    expect(dependencies['@hearthkit/payments']).toBeUndefined()
    expect(dependencies['@hearthkit/storage']).toBeUndefined()
    expect(dependencies['@hearthkit/auth']).toBe(packageVersion)
  })
})
