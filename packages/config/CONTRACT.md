# @hearthkit/config — contract

## Purpose

One validated schema for all environment variables, shared by local and production. Every other hearthkit package contributes a Zod fragment describing only the variables it reads. `config` composes the fragments of the packages an app actually installed, validates `process.env` against the composed schema in a single pass, and returns a typed, frozen config object. If anything is missing or invalid, boot fails with one message that names every failing variable, not just the first.

## Inputs

### Environment variables read by this package itself

| Name       | Type                                         | Required                            | Example      |
| ---------- | -------------------------------------------- | ----------------------------------- | ------------ |
| `NODE_ENV` | enum `development` \| `test` \| `production` | optional, defaults to `development` | `production` |

All other variables are defined by the fragments of other packages, never by `config`.

### Fragment composition mechanism

- Every package that reads environment variables exports a `<name>EnvSchemaFragment` (for example `dbEnvSchemaFragment`), a `z.object({...})` whose keys are the variable names and whose values are Zod schemas that parse the raw string values (`z.url()`, `z.enum(...)`, `z.coerce.number()`, and so on). `config` exports its own `configEnvSchemaFragment` the same way and does not auto-include it.
- Variable names are SCREAMING_SNAKE_CASE (`/^[A-Z][A-Z0-9_]*$/`).
- The app (written by the scaffolder) passes the fragments of exactly the installed packages to `loadHearthkitConfig` / `requireHearthkitConfig`. This is how "optional package fragments are only required when that package is installed" works: an absent package's fragment is simply never passed.
- `config` merges the fragments into one object schema (`.extend` semantics — Zod 4 deprecates `.merge`). Fragments must be disjoint: the same variable name appearing in two fragments is a `config-fragment-conflict` failure, even if the schemas are identical.
- Keys in the env source that no fragment declares are ignored (stripped), since `process.env` always contains unrelated variables.
- An empty-string value is treated the same as an unset variable: it triggers `env-variable-missing` for a required variable and the default for a defaulted one. Compose files and CI often set `VAR=` by accident; silently accepting `""` hides that.

### Public functions

- `loadHearthkitConfig({ fragments, env? })` — `fragments`: array of env schema fragments; `env`: optional record of string to string-or-undefined, defaults to `process.env`. Never throws.
- `requireHearthkitConfig({ fragments, env? })` — same parameters. Throws on any failure; this is the boot path.

## Outputs

- `loadHearthkitConfig` returns a discriminated union on `kind`:
  - `{ kind: 'config-loaded', config }` — `config` is a frozen (`Object.freeze`; all values are primitives, so the freeze is effectively deep) plain object typed from the composed fragments, with defaults applied and coercions performed.
  - any `ConfigFailure` variant (below).
- `requireHearthkitConfig` returns the frozen config directly, or throws an `Error` whose message starts with the matching failure's unique prefix and, for validation failures, names **every** missing or invalid variable with its reason on one line each — aggregate, never first-failure.

### Package entry point

The public entry is `src/index.ts`, a thin named re-export (no `export *`, per repo naming rules). Gates and downstream packages import only from the entry. It re-exports by name:

- Functions and values: `loadHearthkitConfig`, `requireHearthkitConfig`, `configEnvSchemaFragment`, `configInvalidErrorPrefix`, `configFragmentConflictErrorPrefix`, `configFailureSchema`, `configLoadResultSchema`, `configVariableIssueSchema`, `envSchemaFragmentSchema`, `envVariableNameSchema`
- Types: `ConfigFailure`, `ConfigVariableIssue`, `EnvSchemaFragment`, `EnvSource`, `EnvVariableName`, `HearthkitConfigOf`, `LoadHearthkitConfigOptions`

### Subpath export: `@hearthkit/config/register-node-modules-type-stripping`

The package ships one JavaScript module, `register-node-modules-type-stripping.js`, at that subpath. Importing it (for example through `NODE_OPTIONS=--import=...`) registers a `module.registerHooks` load hook that strips types from `.ts` files under a `node_modules` path segment, the set Node 24 refuses to load: "Node.js refuses to handle TypeScript files inside folders under a node_modules path" — https://nodejs.org/docs/latest-v24.x/api/typescript.html. It is a no-op inside the workspace, where nothing hearthkit lives under `node_modules`. Consumers: the `hearthkit` bin, the `create` bin, and the template's `test:e2e` script. It lives in `config` rather than `cli` because every project depends on `config` while an empty selection prunes `cli`. It is the one permitted exception to "TypeScript for every script" (ruled 2026-09-07, placed in `config` 2026-09-08).

## Failure modes

Top-level failures (`ConfigFailure`, discriminated on `kind`):

| `kind`                     | When                                                           | Error message prefix (thrown by `requireHearthkitConfig` and present on the returned failure's `message`) |
| -------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `config-validation-failed` | One or more variables missing or invalid; carries `issues[]`   | `hearthkit config invalid:`                                                                               |
| `config-fragment-conflict` | Two fragments declare the same variable name; carries the name | `hearthkit config fragment conflict:`                                                                     |

Per-variable issues inside `config-validation-failed` (`ConfigVariableIssue`, discriminated on `kind`):

| `kind`                     | When                                                                                                                                                                               |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `env-variable-missing`     | Required variable unset or empty string                                                                                                                                            |
| `env-variable-wrong-type`  | Value present but fails its schema for any reason other than URL format (bad enum value, non-numeric where a number is coerced, non-URL format failures, etc.); carries `expected` |
| `env-variable-invalid-url` | Value present but fails a `z.url()` check (Zod issue code `invalid_format` with format `url`)                                                                                      |

Every issue carries the branded `variableName` so gates can assert the name appears in the aggregate message.

## Dependencies

- Packages: none (`config` is a root of the dependency graph).
- Services: none. Gates need only Node and Zod — no Postgres, MinIO, Mailpit, or Stripe.

## Out of scope

- **Loading `.env` files.** Next.js, compose, and CI populate `process.env`; `config` only reads it.
- **Secrets manager integration (deferred).** Because `config` reads only `process.env`, a future secrets manager just populates the environment before boot. Nothing here may assume variables come from files or a specific loader.
- **Runtime reload or mutation.** The config object is frozen; changing env requires a restart.
- **Defining other packages' variables.** `config` owns the mechanism and `NODE_ENV` only; each package owns its own fragment.

## Verified

Checked 2026-08-27:

- Latest Zod is 4.4.3 — https://registry.npmjs.org/zod/latest
- Zod 4 deprecates `z.string().url()` in favor of top-level `z.url()`, and `.merge()` in favor of `.extend()` — https://zod.dev/v4/changelog
- Failed format checks such as `z.url()` produce issue code `invalid_format`; `z.enum`, `.default()`, and `.brand<'...'>()` exist; object parsing collects all issues in one `safeParse` (aggregate, not first-failure) — https://zod.dev/api

Zod is not yet installed in the workspace; the implementor must add `zod@4.4.3` (exact pin) to this package.

## Questions for the orchestrator

Defaults were chosen so downstream work is not blocked; veto any of these and the contract will be revised.

1. The plan names no variables owned by `config` itself. This contract gives it `NODE_ENV` (optional, defaults to `development`) so "shared by local and production" has a concrete switch. Acceptable, or should `configEnvSchemaFragment` be empty?
2. Empty string is treated as unset (see Inputs). Confirm this is the desired behavior for all packages' variables.
3. `configEnvSchemaFragment` is passed explicitly like any other fragment, not auto-included by `loadHearthkitConfig`. Confirm the scaffolder will always include it.
