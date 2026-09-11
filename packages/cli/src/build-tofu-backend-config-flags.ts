import { tofuStateBucketName } from './cli-contract.ts'

/**
 * The -backend-config flags `tofu init` needs for the R2 state bucket.
 *
 * The module's own backend block is empty on purpose: every setting is passed on the command line, so
 * no bucket name, endpoint or credential is written into a file in the project. The six skip flags
 * and path-style are what the s3 backend needs against a non-AWS endpoint; without them it tries STS,
 * the EC2 metadata service and virtual-host addressing, none of which R2 answers.
 */

/** The R2 region string; R2 has one, and it is spelled auto in every S3 client. */
const tofuStateBucketRegion = 'auto'

/** Builds the -backend-config flag list for one project's state object in the shared state bucket. */
export function buildTofuBackendConfigFlags(options: {
  projectName: string
  accountId: string
}): string[] {
  const backendSettings: [string, string][] = [
    ['bucket', tofuStateBucketName],
    ['key', `${options.projectName}.tfstate`],
    ['region', tofuStateBucketRegion],
    ['endpoints', `{s3="https://${options.accountId}.r2.cloudflarestorage.com"}`],
    ['skip_credentials_validation', 'true'],
    ['skip_region_validation', 'true'],
    ['skip_requesting_account_id', 'true'],
    ['skip_metadata_api_check', 'true'],
    ['skip_s3_checksum', 'true'],
    ['use_path_style', 'true'],
  ]
  return backendSettings.map(([settingName, value]) => `-backend-config=${settingName}=${value}`)
}
