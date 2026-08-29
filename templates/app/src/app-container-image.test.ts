import { describe, expect, it } from 'vitest'
import { readTemplateFileText } from '../test-fixtures/app-template-tree-files.ts'
import {
  appContainerDefaultPort,
  appContainerRunAsUserName,
  appHealthRoutePath,
  appTemplateContainerEnvVariableNames,
  appTemplateEnvVariableNames,
  appTemplateNodeMajorVersion,
} from './app-template-contract.ts'

/** Dockerfile instructions with line continuations joined and comments dropped, in file order. */
function dockerfileInstructions(): string[] {
  return readTemplateFileText('Dockerfile')
    .replace(/\\\r?\n\s*/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
}

const instructionsStartingWith = (instructions: string[], keyword: string): string[] =>
  instructions.filter((instruction) => new RegExp(`^${keyword}\\b`, 'i').test(instruction))

/** One variable an ENV or ARG instruction sets, and where in the file it was set. */
type DockerfileVariableAssignment = {
  variableName: string
  value: string
  instructionIndex: number
}

/** Every NAME=value and NAME value pair an ENV or ARG instruction sets, in file order. */
function environmentAssignments(
  instructions: string[],
  keyword: 'ENV' | 'ARG',
): DockerfileVariableAssignment[] {
  const assignments: DockerfileVariableAssignment[] = []

  instructions.forEach((instruction, instructionIndex) => {
    if (!new RegExp(`^${keyword}\\b`, 'i').test(instruction)) {
      return
    }
    const declaration = instruction.replace(new RegExp(`^${keyword}\\s+`, 'i'), '')

    if (declaration.includes('=')) {
      for (const match of declaration.matchAll(/([A-Z][A-Z0-9_]*)\s*=\s*"?([^"\s]*)"?/g)) {
        const [, variableName, value] = match
        if (variableName !== undefined) {
          assignments.push({ variableName, value: value ?? '', instructionIndex })
        }
      }
      return
    }

    const spaceForm = /^([A-Z][A-Z0-9_]*)\s+"?([^"]*)"?$/.exec(declaration)
    const [, variableName, value] = spaceForm ?? []
    if (variableName !== undefined) {
      assignments.push({ variableName, value: (value ?? '').trim(), instructionIndex })
    }
  })

  return assignments
}

const assignmentOf = (
  assignments: DockerfileVariableAssignment[],
  variableName: string,
): DockerfileVariableAssignment | undefined =>
  assignments.findLast((assignment) => assignment.variableName === variableName)

/** Index of the instruction that builds the app, written either directly or through the build script. */
const indexOfNextBuild = (instructions: string[]): number =>
  instructions.findIndex((instruction) =>
    /^RUN\b.*\b(next build|pnpm (run )?build)\b/i.test(instruction),
  )

describe('the templates/app Dockerfile', () => {
  it('pins a node:24 slim base, installs with a frozen lockfile and starts the standalone server as node', () => {
    const instructions = dockerfileInstructions()
    const dockerfileText = instructions.join('\n')

    // Every stage that names an image names an exactly pinned one; a stage may still build FROM a
    // named earlier stage, which carries no image reference of its own.
    const pinnedBasePattern = new RegExp(
      `^node:${String(appTemplateNodeMajorVersion)}\\.\\d+\\.\\d+-slim(@sha256:[a-f0-9]{64})?$`,
    )
    const baseImages = instructionsStartingWith(instructions, 'FROM')
      .map((instruction) => instruction.split(/\s+/)[1] ?? '')
      .filter((imageReference) => imageReference.includes(':'))
    expect(baseImages.length).toBeGreaterThan(0)
    expect(baseImages.filter((imageReference) => !pinnedBasePattern.test(imageReference))).toEqual(
      [],
    )

    expect(dockerfileText).toMatch(/corepack enable/i)
    expect(dockerfileText).toMatch(/pnpm install --frozen-lockfile/)
    expect(indexOfNextBuild(instructions)).toBeGreaterThanOrEqual(0)

    // Next copies neither .next/static nor public into .next/standalone, so the runner stage must.
    // public/ is a guaranteed path precisely so this COPY cannot fail on a missing directory.
    const copiedIntoTheImage = instructionsStartingWith(instructions, 'COPY').join('\n')
    const uncopiedRunnerPaths = ['.next/standalone', '.next/static', 'public'].filter(
      (runnerPath) => !copiedIntoTheImage.includes(runnerPath),
    )
    expect(uncopiedRunnerPaths).toEqual([])

    // The official node images already ship this user, so nothing creates it.
    expect(dockerfileText).toMatch(new RegExp(`^USER\\s+${appContainerRunAsUserName}$`, 'm'))
    expect(dockerfileText).toMatch(/CMD\s+\[\s*"node"\s*,\s*"server\.js"\s*\]/)
  })

  it('healthchecks the health route with the image own node runtime', () => {
    const instructions = dockerfileInstructions()
    const healthcheckInstructions = instructionsStartingWith(instructions, 'HEALTHCHECK')

    expect(healthcheckInstructions).toHaveLength(1)
    const [healthcheckInstruction = ''] = healthcheckInstructions

    expect(healthcheckInstruction).toContain(appHealthRoutePath)
    expect(healthcheckInstruction).toMatch(/\bnode\b/)
    expect(healthcheckInstruction).toMatch(/127\.0\.0\.1|localhost/)

    // A slim image has neither, and adding one to run a healthcheck is a dependency the app does
    // not otherwise need.
    expect(instructions.join('\n')).not.toMatch(/\b(curl|wget)\b/)
  })

  it('sets no app environment variable at build time and sets PORT and HOSTNAME in the runner stage', () => {
    const instructions = dockerfileInstructions()
    const environmentVariables = environmentAssignments(instructions, 'ENV')
    const buildArguments = environmentAssignments(instructions, 'ARG')
    const nextBuildIndex = indexOfNextBuild(instructions)
    expect(nextBuildIndex).toBeGreaterThanOrEqual(0)

    // next build runs with no environment variable set, which is what keeps every config value a
    // run-time input and lets one image be promoted between environments. A runner-stage default
    // after the build is still fine; a build argument never is.
    const bakedInVariableNames = appTemplateEnvVariableNames.filter(
      (variableName) =>
        assignmentOf(buildArguments, variableName) !== undefined ||
        environmentVariables.some(
          (assignment) =>
            assignment.variableName === variableName &&
            assignment.instructionIndex < nextBuildIndex,
        ),
    )
    expect(bakedInVariableNames).toEqual([])

    // PORT and HOSTNAME are read by Next's standalone server, never validated by config.
    const missingContainerVariableNames = appTemplateContainerEnvVariableNames.filter(
      (variableName) => assignmentOf(environmentVariables, variableName) === undefined,
    )
    expect(missingContainerVariableNames).toEqual([])
    expect(assignmentOf(environmentVariables, 'PORT')?.value).toBe(String(appContainerDefaultPort))
    expect(assignmentOf(environmentVariables, 'HOSTNAME')?.value).toBe('0.0.0.0')

    for (const variableName of appTemplateContainerEnvVariableNames) {
      expect(
        assignmentOf(environmentVariables, variableName)?.instructionIndex ?? -1,
        `ENV ${variableName} belongs in the runner stage, after next build`,
      ).toBeGreaterThan(nextBuildIndex)
    }
  })
})
