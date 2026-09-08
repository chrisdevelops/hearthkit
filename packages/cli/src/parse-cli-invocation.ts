import { isAbsolute, resolve } from 'node:path'
import { postgresConnectionStringSchema, projectDatabaseNameSchema } from '@hearthkit/db'
import {
  cliCommandPathSchema,
  defaultMigrationsFolderPath,
  defaultPaymentsCatalogPath,
  type CliCommandInvocation,
  type CliCommandPath,
  type CliFailure,
} from './cli-contract.ts'
import {
  cliUsageInvalidFailure,
  databaseUrlInvalidFailure,
  databaseUrlMissingFailure,
} from './cli-failure-results.ts'
import type { CliRuntimeContext } from './cli-runtime-context.ts'
import { buildDefaultBackupFilePath } from './default-backup-file-path.ts'
import { readEnvironmentVariableValue } from './read-environment-variable-value.ts'
import { resolveAdminDatabaseUrl } from './resolve-admin-database-url.ts'

/** The project-scoped connection db migrate falls back to; never the admin connection, per the db contract. */
const projectDatabaseUrlEnvVariableName = 'DATABASE_URL'

/** Flags that take the next word as their value; every other double-dash word is either a boolean flag or unknown. */
const valueFlagNames = [
  '--admin-database-url',
  '--database-url',
  '--migrations-folder',
  '--backup-file',
  '--catalog',
] as const

/** Flags that stand alone; giving one a value is a usage failure rather than a silently ignored word. */
const booleanFlagNames = ['--json'] as const

/** Which flags each command accepts, so --json on db create is rejected instead of quietly doing nothing. */
const allowedFlagNamesByCommandPath: Record<CliCommandPath, readonly string[]> = {
  'db create': ['--admin-database-url'],
  'db drop': ['--admin-database-url'],
  'db migrate': ['--database-url', '--migrations-folder'],
  'db backup': ['--admin-database-url', '--backup-file'],
  'db restore': ['--admin-database-url'],
  dev: [],
  'dev infra up': [],
  'dev infra down': [],
  doctor: ['--json'],
  'payments sync': ['--catalog'],
}

/** How many words follow the command itself; checked before any word is handed to a schema. */
const commandArgumentCountByPath: Record<CliCommandPath, number> = {
  'db create': 1,
  'db drop': 1,
  'db migrate': 0,
  'db backup': 1,
  'db restore': 2,
  dev: 0,
  'dev infra up': 0,
  'dev infra down': 0,
  doctor: 0,
  'payments sync': 0,
}

/** A parsed invocation ready to run, or the failure to report; parsing never throws and never runs a command. */
export type CliInvocationParse =
  | { kind: 'cli-invocation-parsed'; invocation: CliCommandInvocation }
  | { kind: 'cli-invocation-rejected'; failure: CliFailure }

/** argv split into command words and flags before any command is known; unknown flags are rejected here. */
type CliArgumentSplit =
  | {
      kind: 'cli-arguments-split'
      commandWords: string[]
      flagValues: Map<string, string>
      presentBooleanFlagNames: Set<string>
      givenFlagNames: Set<string>
    }
  | { kind: 'cli-arguments-rejected'; failure: CliFailure }

/**
 * Turns argv plus the environment into one runnable invocation. Word-shaped mistakes are usage
 * failures (exit 2); a well-formed command whose connection URL does not hold up is an operational
 * failure (exit 1), which is why URL resolution happens here rather than inside a command handler.
 */
export function parseCliInvocation(options: {
  argv: readonly string[]
  context: CliRuntimeContext
}): CliInvocationParse {
  const split = splitCliArguments(options.argv)
  if (split.kind === 'cli-arguments-rejected') {
    return { kind: 'cli-invocation-rejected', failure: split.failure }
  }

  const match = matchCommandPath(split.commandWords)
  if (match.kind === 'command-path-unknown') {
    return rejectedInvocation(
      cliUsageInvalidFailure(
        `unknown command ${JSON.stringify(split.commandWords.join(' '))}; expected one of ${cliCommandPathSchema.options.join(', ')}`,
      ),
    )
  }
  if (match.kind === 'command-argument-count-wrong') {
    return rejectedInvocation(
      cliUsageInvalidFailure(
        `${match.commandPath} takes ${commandArgumentCountByPath[match.commandPath]} argument(s), ${match.commandArguments.length} given`,
      ),
    )
  }

  const unknownFlagName = [...split.givenFlagNames].find(
    (flagName) => !allowedFlagNamesByCommandPath[match.commandPath].includes(flagName),
  )
  if (unknownFlagName !== undefined) {
    return rejectedInvocation(
      cliUsageInvalidFailure(`unknown flag ${unknownFlagName} for hearthkit ${match.commandPath}`),
    )
  }

  return buildCliInvocation({
    commandPath: match.commandPath,
    commandArguments: match.commandArguments,
    flagValues: split.flagValues,
    presentBooleanFlagNames: split.presentBooleanFlagNames,
    context: options.context,
  })
}

/** Wraps a failure as the rejected branch, so every early return below stays one line. */
function rejectedInvocation(failure: CliFailure): CliInvocationParse {
  return { kind: 'cli-invocation-rejected', failure }
}

/** Reads a word the arity check already guaranteed; an empty string still fails its schema below. */
function commandArgumentAt(commandArguments: readonly string[], index: number): string {
  return commandArguments[index] ?? ''
}

/**
 * Separates flags from command words in one pass. Both --flag value and --flag=value are accepted;
 * a lone dash-prefixed word that is in neither catalogue is an unknown flag, never a command word.
 */
function splitCliArguments(argv: readonly string[]): CliArgumentSplit {
  const commandWords: string[] = []
  const flagValues = new Map<string, string>()
  const presentBooleanFlagNames = new Set<string>()
  const givenFlagNames = new Set<string>()

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? ''
    if (!token.startsWith('-')) {
      commandWords.push(token)
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
      if (flagValue === undefined || flagValue === '') {
        return {
          kind: 'cli-arguments-rejected',
          failure: cliUsageInvalidFailure(`${flagName} needs a value`),
        }
      }
      flagValues.set(flagName, flagValue)
      givenFlagNames.add(flagName)
      continue
    }

    if (isBooleanFlagName(flagName)) {
      if (inlineValue !== undefined) {
        return {
          kind: 'cli-arguments-rejected',
          failure: cliUsageInvalidFailure(`${flagName} takes no value`),
        }
      }
      presentBooleanFlagNames.add(flagName)
      givenFlagNames.add(flagName)
      continue
    }

    return {
      kind: 'cli-arguments-rejected',
      failure: cliUsageInvalidFailure(`unknown flag ${flagName}`),
    }
  }

  return {
    kind: 'cli-arguments-split',
    commandWords,
    flagValues,
    presentBooleanFlagNames,
    givenFlagNames,
  }
}

/** True when the word is one of the flags that consumes the next argv word. */
function isValueFlagName(flagName: string): boolean {
  return (valueFlagNames as readonly string[]).includes(flagName)
}

/** True when the word is one of the standalone flags. */
function isBooleanFlagName(flagName: string): boolean {
  return (booleanFlagNames as readonly string[]).includes(flagName)
}

/** Which command the leading words name, and the words left over for it to consume. */
type CommandPathMatch =
  | { kind: 'command-path-matched'; commandPath: CliCommandPath; commandArguments: string[] }
  | {
      kind: 'command-argument-count-wrong'
      commandPath: CliCommandPath
      commandArguments: string[]
    }
  | { kind: 'command-path-unknown' }

/**
 * Matches the longest command path first, so `dev infra up` wins over `dev` and later phases can
 * append longer paths to the enum without disturbing the ones already here.
 */
function matchCommandPath(commandWords: readonly string[]): CommandPathMatch {
  const commandPathsByLength = cliCommandPathSchema.options.toSorted(
    (left, right) => right.split(' ').length - left.split(' ').length,
  )

  for (const commandPath of commandPathsByLength) {
    const pathWords = commandPath.split(' ')
    const isPrefix = pathWords.every((pathWord, index) => commandWords[index] === pathWord)
    if (!isPrefix) {
      continue
    }
    const commandArguments = commandWords.slice(pathWords.length)
    if (commandArguments.length !== commandArgumentCountByPath[commandPath]) {
      return { kind: 'command-argument-count-wrong', commandPath, commandArguments }
    }
    return { kind: 'command-path-matched', commandPath, commandArguments }
  }

  return { kind: 'command-path-unknown' }
}

/** Turns a matched command plus its flags into the invocation shape the handlers receive. */
function buildCliInvocation(options: {
  commandPath: CliCommandPath
  commandArguments: readonly string[]
  flagValues: Map<string, string>
  presentBooleanFlagNames: ReadonlySet<string>
  context: CliRuntimeContext
}): CliInvocationParse {
  const { commandPath, commandArguments, flagValues, context } = options

  if (commandPath === 'dev' || commandPath === 'dev infra up' || commandPath === 'dev infra down') {
    return { kind: 'cli-invocation-parsed', invocation: { commandPath } }
  }

  if (commandPath === 'doctor') {
    return {
      kind: 'cli-invocation-parsed',
      invocation: { commandPath, jsonOutput: options.presentBooleanFlagNames.has('--json') },
    }
  }

  if (commandPath === 'payments sync') {
    const givenCatalogPath = flagValues.get('--catalog') ?? defaultPaymentsCatalogPath
    return {
      kind: 'cli-invocation-parsed',
      invocation: {
        commandPath,
        catalogPath: isAbsolute(givenCatalogPath)
          ? givenCatalogPath
          : resolve(context.workingDirectoryPath, givenCatalogPath),
      },
    }
  }

  if (commandPath === 'db migrate') {
    const databaseUrlCandidate =
      flagValues.get('--database-url') ??
      readEnvironmentVariableValue(context.environmentVariables, projectDatabaseUrlEnvVariableName)
    if (databaseUrlCandidate === undefined) {
      return rejectedInvocation(
        databaseUrlMissingFailure(
          'is not set and --database-url was not given; hearthkit db migrate needs the project connection',
        ),
      )
    }
    const parsedDatabaseUrl = postgresConnectionStringSchema.safeParse(databaseUrlCandidate)
    if (!parsedDatabaseUrl.success) {
      return rejectedInvocation(
        databaseUrlInvalidFailure(
          `not a postgres:// or postgresql:// url (given: ${databaseUrlCandidate})`,
        ),
      )
    }
    return {
      kind: 'cli-invocation-parsed',
      invocation: {
        commandPath,
        databaseUrl: parsedDatabaseUrl.data,
        migrationsFolderPath: flagValues.get('--migrations-folder') ?? defaultMigrationsFolderPath,
      },
    }
  }

  const parsedDatabaseName = projectDatabaseNameSchema.safeParse(
    commandArgumentAt(commandArguments, 0),
  )
  if (!parsedDatabaseName.success) {
    return rejectedInvocation(
      cliUsageInvalidFailure(
        `${commandPath} needs a lowercase snake_case database name of at most 63 characters (given: ${JSON.stringify(commandArgumentAt(commandArguments, 0))})`,
      ),
    )
  }

  const adminResolution = resolveAdminDatabaseUrl({
    adminDatabaseUrlFlagValue: flagValues.get('--admin-database-url'),
    environmentVariables: context.environmentVariables,
  })
  if (adminResolution.kind === 'admin-database-url-rejected') {
    return rejectedInvocation(adminResolution.failure)
  }

  const projectDatabaseName = parsedDatabaseName.data
  const adminDatabaseUrl = adminResolution.adminDatabaseUrl

  if (commandPath === 'db create' || commandPath === 'db drop') {
    return {
      kind: 'cli-invocation-parsed',
      invocation: { commandPath, projectDatabaseName, adminDatabaseUrl },
    }
  }

  if (commandPath === 'db backup') {
    return {
      kind: 'cli-invocation-parsed',
      invocation: {
        commandPath,
        projectDatabaseName,
        adminDatabaseUrl,
        backupFilePath:
          flagValues.get('--backup-file') ??
          buildDefaultBackupFilePath({
            workingDirectoryPath: context.workingDirectoryPath,
            projectDatabaseName,
          }),
      },
    }
  }

  return {
    kind: 'cli-invocation-parsed',
    invocation: {
      commandPath,
      projectDatabaseName,
      adminDatabaseUrl,
      backupFilePath: commandArgumentAt(commandArguments, 1),
    },
  }
}
