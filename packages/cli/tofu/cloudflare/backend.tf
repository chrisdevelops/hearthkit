# State lives in the operator-created R2 bucket hearthkit-tofu-state, one per Cloudflare account.
# Every setting arrives as a -backend-config flag from `hearthkit infra apply`, so no bucket name,
# endpoint or credential is written into this module or into the project that runs it.

terraform {
  backend "s3" {}
}
