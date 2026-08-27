import { z } from 'zod'

/** Unique literal prefix of every aggregate validation error message thrown or returned by config loading. */
export const configInvalidErrorPrefix = 'hearthkit config invalid:'

/** Unique literal prefix of the error raised when two env schema fragments declare the same variable name. */
export const configFragmentConflictErrorPrefix = 'hearthkit config fragment conflict:'

/** Environment variable name; must be SCREAMING_SNAKE_CASE and is branded so plain strings cannot be passed by accident. */
export const envVariableNameSchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]*$/)
  .brand<'EnvVariableName'>()

/** Branded environment variable name accepted and returned wherever config refers to a variable. */
export type EnvVariableName = z.infer<typeof envVariableNameSchema>

/** Raw environment source; shaped like process.env, where any value may be undefined and empty string counts as unset. */
export const envSourceSchema = z.record(z.string(), z.string().optional())

/** Raw environment source type; defaults to process.env when not supplied. */
export type EnvSource = z.infer<typeof envSourceSchema>

/** A package's env schema fragment: a Zod object whose keys are variable names and whose values parse raw string env values. */
export type EnvSchemaFragment = z.ZodObject<Record<string, z.ZodType>>

/** Runtime check that a supplied fragment is a Zod object schema; cannot verify key naming statically, gates do. */
export const envSchemaFragmentSchema = z.custom<EnvSchemaFragment>(
  (value) => value instanceof z.ZodObject,
)

/** Env schema fragment owned by config itself; not auto-included, the app passes it like any other fragment. */
export const configEnvSchemaFragment = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
})

/** One variable's validation problem; missing means unset or empty string, wrong-type covers every non-URL schema failure. */
export const configVariableIssueSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('env-variable-missing'),
    variableName: envVariableNameSchema,
  }),
  z.object({
    kind: z.literal('env-variable-wrong-type'),
    variableName: envVariableNameSchema,
    expected: z.string(),
  }),
  z.object({
    kind: z.literal('env-variable-invalid-url'),
    variableName: envVariableNameSchema,
  }),
])

/** Per-variable issue carried inside a config-validation-failed failure. */
export type ConfigVariableIssue = z.infer<typeof configVariableIssueSchema>

/** Every way config loading can fail; validation failures aggregate all issues, never just the first. */
export const configFailureSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('config-validation-failed'),
    issues: z.array(configVariableIssueSchema).min(1),
    message: z.string().startsWith(configInvalidErrorPrefix),
  }),
  z.object({
    kind: z.literal('config-fragment-conflict'),
    variableName: envVariableNameSchema,
    message: z.string().startsWith(configFragmentConflictErrorPrefix),
  }),
])

/** Discriminated failure union returned by loadHearthkitConfig and thrown (as Error message) by requireHearthkitConfig. */
export type ConfigFailure = z.infer<typeof configFailureSchema>

/** Success shape of loading; config is a frozen plain object, typed precisely only through HearthkitConfigOf. */
export const configLoadedSchema = z.object({
  kind: z.literal('config-loaded'),
  config: z.record(z.string(), z.unknown()),
})

/** Full result union of loadHearthkitConfig for runtime validation in gates; the generic type below carries the precise config shape. */
export const configLoadResultSchema = z.union([configLoadedSchema, configFailureSchema])

/** Runtime shape of the options both public functions accept; env defaults to process.env when omitted. */
export const loadHearthkitConfigOptionsSchema = z.object({
  fragments: z.array(envSchemaFragmentSchema),
  env: envSourceSchema.optional(),
})

/** Options type for loadHearthkitConfig and requireHearthkitConfig, generic so the config type follows the fragments passed. */
export type LoadHearthkitConfigOptions<
  TFragments extends readonly EnvSchemaFragment[] = readonly EnvSchemaFragment[],
> = {
  fragments: TFragments
  env?: EnvSource
}

type UnionToIntersection<U> = (U extends unknown ? (x: U) => void : never) extends (
  x: infer I,
) => void
  ? I
  : never

/** Merged, readonly config type produced by composing the given fragments; defaults applied, coercions performed. */
export type HearthkitConfigOf<TFragments extends readonly EnvSchemaFragment[]> = Readonly<
  UnionToIntersection<z.infer<TFragments[number]>>
>

/** Signature of loadHearthkitConfig: validates env against composed fragments and never throws; failures are returned. */
export type LoadHearthkitConfig = <const TFragments extends readonly EnvSchemaFragment[]>(
  options: LoadHearthkitConfigOptions<TFragments>,
) => { kind: 'config-loaded'; config: HearthkitConfigOf<TFragments> } | ConfigFailure

/** Signature of requireHearthkitConfig: boot path that returns the frozen config or throws an Error naming every failing variable. */
export type RequireHearthkitConfig = <const TFragments extends readonly EnvSchemaFragment[]>(
  options: LoadHearthkitConfigOptions<TFragments>,
) => HearthkitConfigOf<TFragments>
