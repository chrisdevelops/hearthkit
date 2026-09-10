# The credential the app uses to reach the bucket over the S3 API, scoped to this one bucket.
#
# R2 derives S3 credentials from an API token: the access key id is the token's id and the secret is
# the SHA-256 hex of the token's value (developers.cloudflare.com/r2/api/tokens). Both are read back
# by the outputs; neither is written to a file by anything in hearthkit.

resource "cloudflare_api_token" "project_uploads_r2" {
  name = "hearthkit-${var.project_name}-r2"

  policies = [{
    effect = "allow"
    # Workers R2 Storage Bucket Item Write: verified 2026-09-10,
    # GET /client/v4/accounts/{account_id}/tokens/permission_groups. Write covers reads, which is what
    # the dashboard calls "Object Read & Write".
    permission_groups = [{ id = "2efd5506f9c8494dacb1fa10a3e7d5b6" }]
    # Per-bucket resource key: verified 2026-09-10,
    # GET /client/v4/accounts/{account_id}/tokens/{token_id} on a dashboard-created single-bucket
    # R2 token. The account-wide form com.cloudflare.api.account.<account_id> would widen the token
    # to every bucket in the account.
    resources = jsonencode({
      "com.cloudflare.edge.r2.bucket.${var.account_id}_default_${cloudflare_r2_bucket.project_uploads.name}" = "*"
    })
  }]
}
