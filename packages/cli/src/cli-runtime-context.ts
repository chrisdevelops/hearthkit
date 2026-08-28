/**
 * Where one command runs and what it may read. runHearthkitCli resolves this once from its options,
 * so no handler below it reaches for process.cwd() or process.env and every gate can redirect both.
 */
export type CliRuntimeContext = {
  workingDirectoryPath: string
  environmentVariables: Record<string, string | undefined>
}
