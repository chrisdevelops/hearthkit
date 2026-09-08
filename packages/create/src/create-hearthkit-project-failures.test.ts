import { join } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { afterAll, describe, expect, it } from 'vitest'
import {
  closedDockerHostAddress,
  createGateDirectory,
  listProjectFilePaths,
  loadHearthkitCreateEntry,
  removeGateDirectory,
  uniqueGateProjectName,
  withEnvironmentVariables,
} from '../test-fixtures/create-gate-project-directories.ts'
import { appTemplateDirectoryPath } from '../test-fixtures/create-gate-template-manifest.ts'

/**
 * Every failure mode in CONTRACT.md, one gate each, in the order the steps run.
 *
 * All seven assert the same three things, because that is what the union promises a caller: the
 * `kind`, the unique literal message prefix, and the fields that variant carries. Every result goes
 * through `createFailureSchema.parse` first, so a plain thrown Error or a near-miss shape fails here
 * rather than in the bin that has to exit 1 or 2 on it.
 *
 * Nothing here writes inside the repo and nothing here starts a container. The two gates that need a
 * command to fail make it fail the cheapest deterministic way: an install specifier that names a
 * tarball which does not exist, and a DOCKER_HOST on a port nothing is listening on. The contract's
 * suggestion of an unreachable HEARTHKIT_ADMIN_DATABASE_URL would work too, but only after
 * `hearthkit dev infra up` had really started Postgres and Mailpit, which is minutes and a container
 * to clean up for a failure that `dev infra up` itself can produce in milliseconds.
 */

const gateDirectoriesToRemove: string[] = []

afterAll(async () => {
  for (const directoryPath of gateDirectoriesToRemove) {
    await removeGateDirectory(directoryPath)
  }
})

/** A throwaway directory outside the repo, removed after the file finishes whatever the gates did in it. */
async function gateDirectory(purpose: string): Promise<string> {
  const directoryPath = await createGateDirectory(purpose)
  gateDirectoriesToRemove.push(directoryPath)
  return directoryPath
}

describe('createHearthkitProject failure modes', () => {
  it('rejects a project name that is not kebab-case with create-project-name-invalid', async () => {
    const { createHearthkitProject, createFailureSchema, createProjectNameInvalidErrorPrefix } =
      await loadHearthkitCreateEntry()
    const targetDirectory = join(await gateDirectory('name-invalid'), 'project')

    const failure = createFailureSchema.parse(
      await createHearthkitProject({
        projectName: 'Not_A_Valid_Name',
        packages: [],
        targetDirectory,
        install: false,
        startInfra: false,
        interactive: false,
        templateDirectoryPath: appTemplateDirectoryPath,
      }),
    )

    expect(failure.kind).toBe('create-project-name-invalid')
    if (failure.kind !== 'create-project-name-invalid') {
      return
    }
    expect(failure.projectName).toBe('Not_A_Valid_Name')
    expect(failure.message.startsWith(createProjectNameInvalidErrorPrefix)).toBe(true)

    // Validation is step 1 and writing is step 3, so a rejected name leaves nothing behind at all.
    await expect(listProjectFilePaths(targetDirectory)).rejects.toThrow()
  })

  it('names every unknown package at once with create-package-unknown, including db which is never selectable', async () => {
    const { createHearthkitProject, createFailureSchema, createPackageUnknownErrorPrefix } =
      await loadHearthkitCreateEntry()

    const failure = createFailureSchema.parse(
      await createHearthkitProject({
        projectName: uniqueGateProjectName('unknown-pkg'),
        packages: ['storage', 'db', 'analytics'],
        targetDirectory: join(await gateDirectory('unknown-pkg'), 'project'),
        install: false,
        startInfra: false,
        interactive: false,
        templateDirectoryPath: appTemplateDirectoryPath,
      }),
    )

    expect(failure.kind).toBe('create-package-unknown')
    if (failure.kind !== 'create-package-unknown') {
      return
    }
    // Every unknown name, not the first: a user who mistyped twice should not have to run twice.
    // `db` is here because auth and payments pull it in, so naming it is always a mistake.
    expect(failure.unknownPackageNames.toSorted()).toEqual(['analytics', 'db'])
    expect(failure.message.startsWith(createPackageUnknownErrorPrefix)).toBe(true)
  })

  it('rejects organizations without auth with create-organizations-without-auth carrying the resolved set', async () => {
    const {
      createHearthkitProject,
      createFailureSchema,
      createOrganizationsWithoutAuthErrorPrefix,
    } = await loadHearthkitCreateEntry()

    const failure = createFailureSchema.parse(
      await createHearthkitProject({
        projectName: uniqueGateProjectName('orgs-no-auth'),
        packages: ['storage'],
        organizations: true,
        targetDirectory: join(await gateDirectory('orgs-no-auth'), 'project'),
        install: false,
        startInfra: false,
        interactive: false,
        templateDirectoryPath: appTemplateDirectoryPath,
      }),
    )

    expect(failure.kind).toBe('create-organizations-without-auth')
    if (failure.kind !== 'create-organizations-without-auth') {
      return
    }
    // Checked AFTER resolution, which is why the resolved set is what the failure carries: picking
    // payments and organizations together is valid, because payments pulls auth in.
    expect(failure.resolvedPackages).toEqual(['storage'])
    expect(failure.message.startsWith(createOrganizationsWithoutAuthErrorPrefix)).toBe(true)
  })

  it('refuses a target directory that holds any entry with create-target-not-empty', async () => {
    const { createHearthkitProject, createFailureSchema, createTargetNotEmptyErrorPrefix } =
      await loadHearthkitCreateEntry()
    const targetDirectory = join(await gateDirectory('target-not-empty'), 'project')
    await mkdir(targetDirectory, { recursive: true })
    await writeFile(join(targetDirectory, 'README.md'), 'someone was here first\n', 'utf8')

    const failure = createFailureSchema.parse(
      await createHearthkitProject({
        projectName: uniqueGateProjectName('target-not-empty'),
        packages: [],
        targetDirectory,
        install: false,
        startInfra: false,
        interactive: false,
        templateDirectoryPath: appTemplateDirectoryPath,
      }),
    )

    expect(failure.kind).toBe('create-target-not-empty')
    if (failure.kind !== 'create-target-not-empty') {
      return
    }
    // Absolute, because the message a user reads has to name the directory they are standing in.
    expect(failure.targetDirectoryPath).toBe(targetDirectory)
    expect(failure.message.startsWith(createTargetNotEmptyErrorPrefix)).toBe(true)

    // create never deletes: the file that made the directory not empty is still there.
    expect(await listProjectFilePaths(targetDirectory)).toEqual(['README.md'])
  })

  it('reports create-option-missing naming the absent option when packages is absent and interactive is off', async () => {
    const { createHearthkitProject, createFailureSchema, createOptionMissingErrorPrefix } =
      await loadHearthkitCreateEntry()

    const failure = createFailureSchema.parse(
      await createHearthkitProject({
        projectName: uniqueGateProjectName('option-missing'),
        targetDirectory: join(await gateDirectory('option-missing'), 'project'),
        install: false,
        startInfra: false,
        interactive: false,
        templateDirectoryPath: appTemplateDirectoryPath,
      }),
    )

    expect(failure.kind).toBe('create-option-missing')
    if (failure.kind !== 'create-option-missing') {
      return
    }
    // An absent packages array is the prompt-or-fail case; an empty one is a valid explicit answer,
    // which is the distinction the other gates in this file rely on.
    expect(failure.optionName).toBe('packages')
    expect(failure.message.startsWith(createOptionMissingErrorPrefix)).toBe(true)
  })

  it('reports create-install-failed with the exit code and a stderr excerpt when pnpm install cannot resolve packageVersion', async () => {
    const { createHearthkitProject, createFailureSchema, createInstallFailedErrorPrefix } =
      await loadHearthkitCreateEntry()
    const targetDirectory = join(await gateDirectory('install-failed'), 'project')

    // A file: specifier the contract explicitly allows, pointing at a tarball that does not exist,
    // so pnpm fails on this project's own dependencies rather than on anything about the machine.
    const failure = createFailureSchema.parse(
      await createHearthkitProject({
        projectName: uniqueGateProjectName('install-failed'),
        packages: [],
        targetDirectory,
        install: true,
        startInfra: false,
        packageVersion: 'file:./hearthkit-packages/hearthkit-nothing-0.0.0.tgz',
        interactive: false,
        templateDirectoryPath: appTemplateDirectoryPath,
      }),
    )

    expect(failure.kind).toBe('create-install-failed')
    if (failure.kind !== 'create-install-failed') {
      return
    }
    expect(failure.installExitCode).not.toBe(0)
    // Non-empty, because an excerpt that is always blank tells a user nothing. pnpm reports a
    // resolution error on STDOUT, not stderr, so the excerpt has to be taken from the failing
    // command's output rather than from its stderr stream alone despite the field's name.
    expect(
      failure.installOutputExcerpt.length,
      'installOutputExcerpt must carry the failing pnpm output, which pnpm writes to stdout',
    ).toBeGreaterThan(0)
    expect(failure.message.startsWith(createInstallFailedErrorPrefix)).toBe(true)

    // Step 6 failed, so the step 4 and 5 tree stays on disk for the user to inspect and rerun.
    expect(await listProjectFilePaths(targetDirectory)).toContain('package.json')
  })

  it('wraps a CliFailure as create-infra-up-failed naming which hearthkit command failed', async () => {
    const { createHearthkitProject, createFailureSchema, createInfraUpFailedErrorPrefix } =
      await loadHearthkitCreateEntry()
    const targetDirectory = join(await gateDirectory('infra-up-failed'), 'project')

    // storage alone derives minio and no database, so `dev infra up` is the only hearthkit command
    // that runs and the failure cannot come from anywhere else.
    const failure = await withEnvironmentVariables(
      { DOCKER_HOST: await closedDockerHostAddress() },
      async () =>
        createFailureSchema.parse(
          await createHearthkitProject({
            projectName: uniqueGateProjectName('infra-up-failed'),
            packages: ['storage'],
            targetDirectory,
            install: false,
            startInfra: true,
            interactive: false,
            templateDirectoryPath: appTemplateDirectoryPath,
          }),
        ),
    )

    expect(failure.kind).toBe('create-infra-up-failed')
    if (failure.kind !== 'create-infra-up-failed') {
      return
    }
    expect(failure.failedCommand).toBe('hearthkit dev infra up')
    // Carried verbatim, so a user can act on what the CLI actually said rather than on a summary.
    expect(failure.cliFailure.kind).toBe('docker-unavailable')
    expect(failure.message.startsWith(createInfraUpFailedErrorPrefix)).toBe(true)

    // The compose file the failed command was pointed at is still on disk, unrolled back.
    expect(await listProjectFilePaths(targetDirectory)).toContain('docker-compose.yml')
  })
})
