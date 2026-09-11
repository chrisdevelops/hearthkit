# @hearthkit/create — contract

## Purpose

Scaffold a new project from `templates/app`. One function, `createHearthkitProject(options)`, takes every choice as an option, resolves package dependencies without asking, copies the template with the unselected sections pruned, writes the generated files the template does not carry, runs install and local infra, and reports the written tree and the commands that ran. The `pnpm create @hearthkit` bin (`npm init @scope` runs `@scope/create`, see Verified) parses flags into this options object and exits with the result; the function is the unit under gate, the bin is a thin wrapper. Prompts exist only as a fallback for a required option that is absent while `interactive` is on.

## Inputs

### Environment variables

None read by this package. `createEnvSchemaFragment` is empty. `hearthkit db create` reads `HEARTHKIT_ADMIN_DATABASE_URL` through `@hearthkit/cli`'s own resolution.

### `hearthkitCreateOptions`

| Option                  | Type                      | Default                                                 | Flag                                 |
| ----------------------- | ------------------------- | ------------------------------------------------------- | ------------------------------------ |
| `projectName`           | string, validated below   | required (prompted, or `create-option-missing`)         | positional                           |
| `packages`              | string[], validated below | required (prompted, or `create-option-missing`)         | `--packages a,b`                     |
| `organizations`         | boolean                   | `false`                                                 | `--organizations`                    |
| `targetDirectory`       | string                    | `./<projectName>`, resolved from `process.cwd()`        | `--target-directory`                 |
| `install`               | boolean                   | `true`                                                  | `--no-install`                       |
| `startInfra`            | boolean                   | `true`                                                  | `--no-start-infra`                   |
| `packageVersion`        | string                    | the version in `@hearthkit/create`'s own `package.json` | `--package-version`                  |
| `interactive`           | boolean                   | `process.stdin.isTTY === true`                          | `--interactive` / `--no-interactive` |
| `templateDirectoryPath` | string                    | the copy of `templates/app` shipped inside this package | none (programmatic only)             |

- `projectName` must satisfy `hearthkitProjectNameSchema` from `@hearthkit/cli` (`^[a-z][a-z0-9-]*$`, at most 63 characters). It is the same `HearthkitProjectName` the CLI, the compose file and the bucket name are built from; `create` declares no second name type.
- `packages` names are bare: `storage`, `email`, `auth`, `payments` (`createOptionalPackageNameSchema`). `db` is not selectable. An empty array is a valid explicit selection meaning no optional package; an absent value is what triggers the prompt or the failure.
- `packageVersion` is written verbatim as the dependency specifier of every `@hearthkit/*` dependency in the generated `package.json`; one string, for the published flow. The scaffold gates install against packed tarballs by writing `pnpm.overrides` into the generated `package.json` after scaffolding, the mechanism `verify:container` already uses, so `create` itself never sees a tarball path.
- `templateDirectoryPath` exists so the workspace's `verify:container` (completion plan 3.2) and the scaffold gates read the live `templates/app` rather than a bundled copy. The bin never exposes it. The section manifest is `<templateDirectoryPath>/src/app-template-contract.ts`, loaded by dynamic import at run time. The bundled default exists because the package's `prepack` step copies `templates/app` into the package (excluding `appTemplateNeverCopiedDirectoryNames`, `appTemplateNeverCopiedFileNames`, `appTemplateRepoOnlyPaths` and everything under `appTemplateRepoOnlyDirectoryNames` except that one manifest file) and `files` includes that copy, so the published tarball is self-contained; the workspace always passes the live path explicitly. A generated project never receives `src/` either way.

### Prompting

When `projectName` or `packages` is absent: if `interactive` is true, prompt on `process.stdin` / `process.stderr` (a free-text name; a multi-select of the four packages, in which selecting nothing is a valid answer); otherwise return `create-option-missing` naming the option. A prompted answer is validated exactly like a flag value and fails with the same kind; there is no re-prompt loop. A gate for the prompt path spawns the bin with `--interactive` and a piped stdin.

## Behaviour

Steps run in this order and stop at the first failure. Nothing is written before step 3, and `create` never deletes a directory: after a failure in step 5 the written tree stays on disk for inspection.

1. **Validate.** `projectName` against the schema (`create-project-name-invalid`), then every entry of `packages` against the enum (`create-package-unknown`, carrying every unknown name), then `organizations` (`create-organizations-without-auth`, checked after resolution so `payments` plus `organizations` is valid).
2. **Resolve.** `auth` pulls `db` and `email`; `payments` pulls `auth` and therefore `db` and `email`. The result is `resolvedPackages`, deduplicated and reported in `resolvedHearthkitPackageNameSchema` order: `db, storage, email, auth, payments`. The template selection is the resolved set minus `db`, each mapped to its scoped name (`storage` to `@hearthkit/storage`, and so on), which is always closed over the manifest's `requiredOptionalPackageNames`.
3. **Check the target.** Resolve `targetDirectory` to an absolute path. If it exists and holds any entry, `create-target-not-empty`. An absent or empty directory is fine; parents are created.
4. **Copy and prune the template.** The pruning logic lives in this package; the template keeps `app-template-contract.ts` as data. For every path, in this precedence: `appTemplateNeverCopiedDirectoryNames`, `.git`, and any file named in `appTemplateNeverCopiedFileNames` wherever it sits are never copied; `appTemplateRepoOnlyDirectoryNames` and `appTemplateRepoOnlyPaths` are never copied; a path in an unselected package's `ownedTemplatePaths` is dropped; everything else is copied. A directory whose files were all dropped is not created. A file containing `hearthkit-section:begin` or `hearthkit-section:end` is written through block pruning with the explicit selection: each unselected package's blocks are deleted whole with the blank lines after them, each kept block loses its begin and end lines, every other line is byte for byte, and no marker text survives in the project. Markers that do not balance throw with `hearthkit app template optional block malformed:` (a template defect, not a `CreateFailure`). A file with no marker is copied byte for byte. `gitignore` is written as `.gitignore`. Then the ten `appTemplateScaffoldRewriteTargets` are applied. Nine are edits to `package.json` or deletions: `name` becomes `projectName`; every `workspace:*` specifier becomes `packageVersion`; the repo-only scripts and dev dependencies are deleted; each unselected package's `hearthkitDependencyNames`, `devDependencyNames` and added scripts are deleted; `scripts.dev` is `next dev` when the selection is empty and `hearthkit dev` otherwise. `transpilePackages` needs no JSON edit because `next.config.ts` carries marked blocks. Target ten, `organizations-flag-literal`: with `organizations: true`, the single line `export const appOrganizationsEnabled = false` in `app-auth-server.ts` is rewritten to `true`. No other source line is ever rewritten.
5. **Write the generated files.** `.env.example` and `Dockerfile` are the pruned copies from step 4 (both are guaranteed template paths; nothing else generates them). `docker-compose.yml` is `generateLocalInfraCompose({ hearthkitProjectName, infraServices })` from `@hearthkit/cli`, with services derived from `resolvedPackages`: `db` gives `postgres`, `storage` gives `minio`, `email` gives `mailpit`; with no service the file is not written. `infra/tofu.tfvars` holds five assignments: `project_name = "<projectName>"` filled in, and `zone_name`, `zone_id`, `account_id` and `host_ip` as `""` placeholders, each under a one-line comment saying where its value comes from. `hearthkit infra apply` refuses to run while any of the four is blank. `.env.production.example` is a guaranteed template path and arrives as a pruned copy like `.env.example`.
6. **Run commands** from the project directory, in this order, each only when its condition holds: `pnpm install` when `install`; `hearthkit dev infra up` when `startInfra` and at least one infra service was derived; `hearthkit db create <databaseName>` when `startInfra` and `db` is resolved. `databaseName` is `projectName` with every `-` replaced by `_`, which is total onto `ProjectDatabaseName`. The two hearthkit commands run through `runHearthkitCli` from this package's own dependency on `@hearthkit/cli`, so they do not depend on `install` having run. A nonzero `pnpm install` is `create-install-failed`; a `CliFailure` from either hearthkit command is `create-infra-up-failed` carrying it verbatim and naming which command failed.
7. **Print next steps** to stdout as one line each: change into the directory; copy `.env.example` to `.env` and fill the required values, quoting the connection string `db create` printed and `deriveLocalStorageBucketName(projectName)` as `STORAGE_BUCKET` when `storage` is resolved; `pnpm db:generate` then `hearthkit db migrate` when `db` is resolved; `stripe listen` when `payments` is resolved; `pnpm dev`. The same lines are `nextSteps` in the result.

## Outputs

`createHearthkitProject` resolves with `{ kind: 'hearthkit-project-created', projectName, projectDirectoryPath, resolvedPackages, organizationsEnabled, writtenPaths, commandsRun, nextSteps }` or a `CreateFailure`. It never throws for a listed failure mode.

- `projectDirectoryPath` is absolute. `writtenPaths` are the relative POSIX paths of every file written, in generated-project form (`.gitignore`, not `gitignore`), sorted ascending; with an empty selection they are exactly `appGeneratedProjectGuaranteedPaths` plus `infra/tofu.tfvars`.
- `commandsRun` lists, in run order, only commands that completed: `pnpm install`; `hearthkit dev infra up` with `startedInfraServices`; `hearthkit db create` with `projectDatabaseName` and `connectionString`. The connection string is returned once and written to no file, matching the db and cli contracts.
- The bin prints the next steps on stdout, exits 0 on success, 2 for the four validation failures, 1 for the other three, with the failure message as the last stderr line.

## Failure modes

One discriminated union, `CreateFailure`, on `kind`. Every variant carries a `message` starting with its unique literal prefix.

| `kind`                              | When                                                       | Message prefix                                 | Carries                                                                                                                                     |
| ----------------------------------- | ---------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `create-option-missing`             | `projectName` or `packages` absent and `interactive` false | `hearthkit create option missing:`             | `optionName`                                                                                                                                |
| `create-project-name-invalid`       | name fails `hearthkitProjectNameSchema`                    | `hearthkit create project name invalid:`       | `projectName`                                                                                                                               |
| `create-package-unknown`            | a `packages` entry is not one of the four bare names       | `hearthkit create package unknown:`            | `unknownPackageNames`                                                                                                                       |
| `create-organizations-without-auth` | `organizations` true and `auth` not in the resolved set    | `hearthkit create organizations without auth:` | `resolvedPackages`                                                                                                                          |
| `create-target-not-empty`           | target directory exists with at least one entry            | `hearthkit create target not empty:`           | `targetDirectoryPath`                                                                                                                       |
| `create-install-failed`             | `pnpm install` exited nonzero                              | `hearthkit create install failed:`             | `installExitCode`, `installOutputExcerpt` (last lines of combined stdout and stderr, non-empty; pnpm reports resolution failures on stdout) |
| `create-infra-up-failed`            | `dev infra up` or `db create` returned a `CliFailure`      | `hearthkit create infra up failed:`            | `failedCommand`, `cliFailure`                                                                                                               |

A malformed template block throws the template's own prefix and is not in this union, because it is a defect in the shipped template that no option can cause.

## Dependencies

- Packages: `@hearthkit/cli` (`generateLocalInfraCompose`, `deriveLocalStorageBucketName`, `runHearthkitCli`, `hearthkitProjectNameSchema`, `cliFailureSchema`, `localInfraServiceNameSchema`), `@hearthkit/db` (`projectDatabaseNameSchema`, `postgresConnectionStringSchema`), and the section manifest `<templateDirectoryPath>/src/app-template-contract.ts`, dynamically imported at run time. That manifest imports values from `@hearthkit/config`, `@hearthkit/observability` and `@hearthkit/ui/ui-contract`, so those three are runtime dependencies of `create` too. `zod@4.4.3`.
- Services for gates: Docker with compose (Postgres 17, MinIO, Mailpit through the generated compose file), `pnpm` on PATH, a Stripe test-mode key for the every-package variant's payments flow, Playwright browsers. The three scaffold variants (every package; none; `auth` only with `organizations`) install against packed tarballs, typecheck, boot, and run the smoke test plus the flows of their resolved packages; the empty variant also builds the Dockerfile.

## Out of scope

- **A second template.** One `templateDirectoryPath`, one manifest. A later template is an added option, not a change to this one.
- **Any infrastructure provider.** `infra/tofu.tfvars` carries the project name plus four blank placeholders; filling them, choosing the provider and running `hearthkit infra apply` belong to the operator and to `@hearthkit/cli`, not to `create`.
- **Writing `.env`, or persisting the connection string.** `create` prints both once; the template contract's `.env.example`-only rule and the cli contract's never-persisted rule both hold. A later `--write-env` is additive.
- **Filtering skills and `AGENTS.md` to the chosen packages (Phase 8).** Not blocked: step 4 is a path decision plus a block rule driven by one manifest, so a skills directory joins the tree by adding paths to the manifest and nothing here dispatches on file type.
- **Rolling back after a failed install or infra step.** The tree stays; the user reruns the printed command by hand.
- **Port allocation, editing an existing compose file, a preview-environment suffix.** All Phase 2 or deferred; `db create` and the tfvars already take a name.

## Verified

Checked 2026-09-07:

- `npm init @usr` runs `npm exec @usr/create`, and `npm create` is an alias of `npm init`, so `pnpm create @hearthkit` resolves to the package `@hearthkit/create` — https://docs.npmjs.com/cli/v11/commands/npm-init. pnpm's own page says only that `pnpm create` runs "a `create-*` or `@foo/create-*` starter kit" — https://pnpm.io/cli/create; the scoped no-suffix form is the npm rule pnpm follows.
- `projectDatabaseNameSchema` is `^[a-z][a-z0-9_]*$`, max 63, and `hearthkitProjectNameSchema` is `^[a-z][a-z0-9-]*$`, max 63 (`packages/db/src/db-contract.ts:43`, `packages/cli/src/cli-contract.ts:79`), so a hyphenated project name cannot be passed to `db create` unchanged; the `-` to `_` rule in step 6 is forced by that.
- `appOrganizationsEnabled` is a source literal, `export const appOrganizationsEnabled = false`, in `templates/app/app-auth-server.ts:24`, read by `app-payments-client.ts`; no marked block or JSON field selects it, which is why `organizations-flag-literal` is a declared rewrite target.
- Nothing on plan section 14's verify-at-build-time list is touched by this package.

## Decisions

Ruled by the orchestrator on 2026-09-07; no open questions.

1. **`organizations` is a tenth declared rewrite target, `organizations-flag-literal`.** Plan 4.10 says `create` applies the rewrites the template's manifest declares, so a declared target is within the plan. The template contract's "source may only be deleted from" rule was a Phase 5 ruling and is amended to name this one exception; `appTemplateScaffoldRewriteTargets` and `templates/app/CONTRACT.md` were updated in the same round.
2. **`templateDirectoryPath` is a programmatic-only option.** The bundled default comes from the `prepack` copy described under Inputs; the workspace always passes the live path.
3. **No `.env` is written.** The bucket name and the connection string are printed in next steps and persisted nowhere, matching the template and cli contracts.
