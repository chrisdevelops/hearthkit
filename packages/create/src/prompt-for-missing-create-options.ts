import { createInterface } from 'node:readline'
import { createOptionalPackageNameSchema } from './create-contract.ts'

/**
 * The TTY fallback: flags first, prompts only for a required option that is absent.
 *
 * Line-based rather than keypress-based, and the prompt text goes to stderr rather than stdout. Both
 * are forced by who has to be able to answer: a gate piping two lines into the bin, a CI job and an
 * agent all have a pipe and no terminal, and stdout carries the next-steps lines a script reads.
 *
 * Answers are pulled from the interface's async iterator rather than from `question()`. A pipe
 * delivers every line in one chunk, readline emits both `line` events at once, and `question()` only
 * listens from the moment it is called — so the second answer is dropped and the second prompt never
 * settles. The iterator queues lines instead, which is what makes two prompts over one pipe work.
 *
 * There is no re-prompt loop. A prompted answer is validated exactly like a flag value and fails with
 * the same kind, so a mistyped package name reports create-package-unknown rather than asking again.
 */

/** What the prompt phase produced; either value is whatever was already given as a flag when it was. */
export type PromptedCreateOptions = {
  projectName: string | undefined
  packages: string[] | undefined
}

/** Splits a prompted package answer on commas and whitespace; an empty answer is a valid selection of nothing. */
export function parsePromptedPackageNames(answer: string): string[] {
  return answer
    .split(/[\s,]+/)
    .map((packageName) => packageName.trim())
    .filter((packageName) => packageName !== '')
}

/** Asks for whichever of the two required options is missing, in flag order, and answers both. */
export async function promptForMissingCreateOptions(options: {
  projectName: string | undefined
  packages: string[] | undefined
}): Promise<PromptedCreateOptions> {
  if (options.projectName !== undefined && options.packages !== undefined) {
    return { projectName: options.projectName, packages: options.packages }
  }

  const readlineInterface = createInterface({ input: process.stdin })
  // Taken before the first await, so every line the pipe already delivered is queued rather than lost.
  const answerLines = readlineInterface[Symbol.asyncIterator]()

  const askForLine = async (promptText: string): Promise<string> => {
    process.stderr.write(promptText)
    const answer = await answerLines.next()
    return answer.done === true ? '' : answer.value.trim()
  }

  try {
    const projectName = options.projectName ?? (await askForLine('project name: '))
    const packages =
      options.packages ??
      parsePromptedPackageNames(
        await askForLine(
          `packages, comma separated (${createOptionalPackageNameSchema.options.join(', ')}; empty for none): `,
        ),
      )
    return { projectName, packages }
  } finally {
    await answerLines.return?.()
    readlineInterface.close()
  }
}
