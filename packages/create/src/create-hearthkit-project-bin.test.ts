import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  createGateDirectory,
  listProjectFilePaths,
  removeGateDirectory,
  resolveAdvertisedCreateBinPath,
  runGateCommand,
  uniqueGateProjectName,
} from '../test-fixtures/create-gate-project-directories.ts'
import {
  appGeneratedProjectGuaranteedPaths,
  appTemplateSectionsByOptionalPackage,
} from '../test-fixtures/create-gate-template-manifest.ts'

/**
 * The prompt fallback, driven the only way a gate can drive it: the real bin as a child process with
 * a pipe on its stdin.
 *
 * Two prompts fire here, because neither the positional name nor `--packages` is given and
 * `--interactive` forces prompting on despite stdin not being a TTY. The answers arrive as two
 * lines, which fixes the shape of both prompts: they must read lines from `process.stdin`, not raw
 * keypresses from a TTY, or nothing outside a terminal can ever answer them — not this gate, not a
 * CI job, not an agent. A package answer of `storage` rather than an empty line is deliberate:
 * an empty answer is indistinguishable from a prompt that never happened.
 */

const gateDirectoriesToRemove: string[] = []

afterAll(async () => {
  for (const directoryPath of gateDirectoriesToRemove) {
    await removeGateDirectory(directoryPath)
  }
})

describe('the pnpm create @hearthkit bin', () => {
  it('prompts for the project name and the packages when neither flag is given and writes the tree it was told to', async () => {
    const binPath = await resolveAdvertisedCreateBinPath()
    const workingDirectoryPath = await createGateDirectory('bin-prompt')
    gateDirectoriesToRemove.push(workingDirectoryPath)
    const projectName = uniqueGateProjectName('prompt')

    const outcome = await runGateCommand({
      command: process.execPath,
      commandArguments: [binPath, '--interactive', '--no-install', '--no-start-infra'],
      workingDirectoryPath,
      standardInputText: `${projectName}\nstorage\n`,
    })

    expect(
      outcome.exitCode,
      `bin exited ${String(outcome.exitCode)}\nstdout:\n${outcome.standardOutput}\nstderr:\n${outcome.standardError}`,
    ).toBe(0)

    // The default target is ./<project-name> under the directory the bin ran in, so answering the
    // name prompt is what decided where this tree went.
    const projectDirectoryPath = join(workingDirectoryPath, projectName)
    const writtenPaths = await listProjectFilePaths(projectDirectoryPath)
    expect(writtenPaths).toEqual(expect.arrayContaining([...appGeneratedProjectGuaranteedPaths]))

    // And answering the package prompt with storage is what put storage's own files in it.
    expect(writtenPaths).toEqual(
      expect.arrayContaining([
        ...appTemplateSectionsByOptionalPackage['@hearthkit/storage'].ownedTemplatePaths,
      ]),
    )

    // Next steps go to stdout, one line each, so a terminal shows them and a script can read them.
    expect(outcome.standardOutput).toContain(projectName)
    expect(outcome.standardOutput).toContain('.env.example')
  })
})
