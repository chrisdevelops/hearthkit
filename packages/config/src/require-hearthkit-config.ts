import type {
  EnvSchemaFragment,
  HearthkitConfigOf,
  LoadHearthkitConfigOptions,
} from './config-contract.ts'
import { loadHearthkitConfig } from './load-hearthkit-config.ts'

/** Boot path: returns the frozen config or throws an Error whose message is the failure message, naming every failing variable rather than only the first. */
export function requireHearthkitConfig<const TFragments extends readonly EnvSchemaFragment[]>(
  options: LoadHearthkitConfigOptions<TFragments>,
): HearthkitConfigOf<TFragments> {
  const result = loadHearthkitConfig(options)

  if (result.kind !== 'config-loaded') {
    throw new Error(result.message)
  }

  return result.config
}
