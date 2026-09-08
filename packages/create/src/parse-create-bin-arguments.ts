import type { HearthkitCreateOptions } from './create-contract.ts'

/**
 * Flags first: every option of `createHearthkitProject` that a user may set has a flag, and the bin
 * only turns argv into that options object. Prompting is the function's fallback for a required
 * option that is still absent, never something this file decides.
 *
 * `templateDirectoryPath` has no flag on purpose. It exists so the workspace's own harnesses can
 * scaffold from the live `templates/app`; a user always gets the copy this package ships.
 */

/** Unique literal prefix of the stderr line the bin prints when argv holds a word it does not know. */
export const createBinUsageErrorPrefix = 'hearthkit create usage:'

/** Flags that take the next word as their value; every other double-dash word is a boolean or unknown. */
const valueFlagNames = ['--packages', '--target-directory', '--package-version'] as const

/** Flags that stand alone; each sets one boolean, and the --no- form sets it the other way. */
const booleanFlagValues = {
  '--organizations': { optionName: 'organizations', optionValue: true },
  '--install': { optionName: 'install', optionValue: true },
  '--no-install': { optionName: 'install', optionValue: false },
  '--start-infra': { optionName: 'startInfra', optionValue: true },
  '--no-start-infra': { optionName: 'startInfra', optionValue: false },
  '--interactive': { optionName: 'interactive', optionValue: true },
  '--no-interactive': { optionName: 'interactive', optionValue: false },
} as const satisfies Record<
  string,
  { optionName: 'organizations' | 'install' | 'startInfra' | 'interactive'; optionValue: boolean }
>

/** Parsed argv, or the usage line to print before exiting 2; parsing never scaffolds anything. */
export type CreateBinArgumentParse =
  | { kind: 'create-arguments-parsed'; createOptions: HearthkitCreateOptions }
  | { kind: 'create-arguments-rejected'; message: string }

/** True when the word is one of the flags that consumes the next argv word. */
function isValueFlagName(flagName: string): flagName is (typeof valueFlagNames)[number] {
  return (valueFlagNames as readonly string[]).includes(flagName)
}

/** True when the word is one of the standalone boolean flags. */
function isBooleanFlagName(flagName: string): flagName is keyof typeof booleanFlagValues {
  return Object.hasOwn(booleanFlagValues, flagName)
}

/** Splits a --packages value on commas and whitespace; an empty value is a valid selection of nothing. */
export function parsePackagesFlagValue(flagValue: string): string[] {
  return flagValue
    .split(/[\s,]+/)
    .map((packageName) => packageName.trim())
    .filter((packageName) => packageName !== '')
}

/** Turns the bin's argv, without the node and script prefix, into a createHearthkitProject options object. */
export function parseCreateBinArguments(argv: readonly string[]): CreateBinArgumentParse {
  const createOptions: HearthkitCreateOptions = {}
  const positionalWords: string[] = []

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? ''
    if (!token.startsWith('-')) {
      positionalWords.push(token)
      continue
    }

    const equalsIndex = token.indexOf('=')
    const flagName = equalsIndex === -1 ? token : token.slice(0, equalsIndex)
    const inlineValue = equalsIndex === -1 ? undefined : token.slice(equalsIndex + 1)

    if (isValueFlagName(flagName)) {
      const flagValue = inlineValue ?? argv[index + 1]
      if (inlineValue === undefined) {
        index += 1
      }
      if (flagValue === undefined) {
        return {
          kind: 'create-arguments-rejected',
          message: `${createBinUsageErrorPrefix} ${flagName} needs a value`,
        }
      }
      if (flagName === '--packages') {
        createOptions.packages = parsePackagesFlagValue(flagValue)
      } else if (flagName === '--target-directory') {
        createOptions.targetDirectory = flagValue
      } else {
        createOptions.packageVersion = flagValue
      }
      continue
    }

    if (isBooleanFlagName(flagName)) {
      if (inlineValue !== undefined) {
        return {
          kind: 'create-arguments-rejected',
          message: `${createBinUsageErrorPrefix} ${flagName} takes no value`,
        }
      }
      const { optionName, optionValue } = booleanFlagValues[flagName]
      createOptions[optionName] = optionValue
      continue
    }

    return {
      kind: 'create-arguments-rejected',
      message: `${createBinUsageErrorPrefix} unknown flag ${flagName}`,
    }
  }

  if (positionalWords.length > 1) {
    return {
      kind: 'create-arguments-rejected',
      message: `${createBinUsageErrorPrefix} expected at most one project name, received ${positionalWords.join(', ')}`,
    }
  }
  const [projectName] = positionalWords
  if (projectName !== undefined) {
    createOptions.projectName = projectName
  }

  return { kind: 'create-arguments-parsed', createOptions }
}
