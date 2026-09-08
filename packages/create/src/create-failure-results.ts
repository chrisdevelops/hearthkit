import type { CliFailure } from '@hearthkit/cli'
import {
  createInfraUpFailedErrorPrefix,
  createInstallFailedErrorPrefix,
  createOptionMissingErrorPrefix,
  createOrganizationsWithoutAuthErrorPrefix,
  createPackageUnknownErrorPrefix,
  createProjectNameInvalidErrorPrefix,
  createTargetNotEmptyErrorPrefix,
  type CreateFailure,
  type CreateRequiredOptionName,
  type ResolvedHearthkitPackageName,
} from './create-contract.ts'

/** Every failure this package returns is built here, so each message keeps its unique literal prefix in one place. */
type CreateFailureOf<TKind extends CreateFailure['kind']> = Extract<CreateFailure, { kind: TKind }>

/** A required option was absent and prompting was off, so nothing was validated and nothing was written. */
export function createOptionMissingFailure(
  optionName: CreateRequiredOptionName,
): CreateFailureOf<'create-option-missing'> {
  return {
    kind: 'create-option-missing',
    optionName,
    message: `${createOptionMissingErrorPrefix} ${optionName} was not given and prompting is off; pass it as a flag or run with --interactive`,
  }
}

/** The project name does not satisfy hearthkitProjectNameSchema, so no directory was touched. */
export function createProjectNameInvalidFailure(
  projectName: string,
): CreateFailureOf<'create-project-name-invalid'> {
  return {
    kind: 'create-project-name-invalid',
    projectName,
    message: `${createProjectNameInvalidErrorPrefix} ${JSON.stringify(projectName)} must be lowercase kebab-case, start with a letter, and be at most 63 characters`,
  }
}

/** One or more selected package names are outside storage, email, auth and payments; every one of them is named. */
export function createPackageUnknownFailure(
  unknownPackageNames: readonly string[],
): CreateFailureOf<'create-package-unknown'> {
  return {
    kind: 'create-package-unknown',
    unknownPackageNames: [...unknownPackageNames],
    message: `${createPackageUnknownErrorPrefix} ${unknownPackageNames.join(', ')}; choose from storage, email, auth, payments`,
  }
}

/** organizations was asked for but the resolved set holds no auth, which is checked after resolution so payments plus organizations stays valid. */
export function createOrganizationsWithoutAuthFailure(
  resolvedPackages: readonly ResolvedHearthkitPackageName[],
): CreateFailureOf<'create-organizations-without-auth'> {
  return {
    kind: 'create-organizations-without-auth',
    resolvedPackages: [...resolvedPackages],
    message: `${createOrganizationsWithoutAuthErrorPrefix} organizations needs auth, and the resolved packages are ${resolvedPackages.length === 0 ? 'none' : resolvedPackages.join(', ')}`,
  }
}

/** The target directory already holds at least one entry; create never deletes, so it refuses instead. */
export function createTargetNotEmptyFailure(
  targetDirectoryPath: string,
): CreateFailureOf<'create-target-not-empty'> {
  return {
    kind: 'create-target-not-empty',
    targetDirectoryPath,
    message: `${createTargetNotEmptyErrorPrefix} ${targetDirectoryPath} already holds at least one entry; choose an empty or absent directory`,
  }
}

/** pnpm install exited nonzero inside the written project, which stays on disk for the user to inspect. */
export function createInstallFailedFailure(options: {
  installExitCode: number
  installOutputExcerpt: string
}): CreateFailureOf<'create-install-failed'> {
  return {
    kind: 'create-install-failed',
    installExitCode: options.installExitCode,
    installOutputExcerpt: options.installOutputExcerpt,
    message: `${createInstallFailedErrorPrefix} pnpm install exited ${String(options.installExitCode)}: ${options.installOutputExcerpt}`,
  }
}

/** One of the two hearthkit commands returned a CliFailure, carried out verbatim behind this package's prefix. */
export function createInfraUpFailedFailure(options: {
  failedCommand: 'hearthkit dev infra up' | 'hearthkit db create'
  cliFailure: CliFailure
}): CreateFailureOf<'create-infra-up-failed'> {
  return {
    kind: 'create-infra-up-failed',
    failedCommand: options.failedCommand,
    cliFailure: options.cliFailure,
    message: `${createInfraUpFailedErrorPrefix} ${options.failedCommand} failed: ${options.cliFailure.message}`,
  }
}
