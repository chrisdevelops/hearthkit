# The six values hearthkit infra apply reads back with `tofu output -json`. Five of them become the
# project's production STORAGE_* variables; the sixth is fixed guidance, because no Cloudflare
# resource can produce a GlitchTip DSN.

output "hostname" {
  description = "Hostname the DNS A record answers on; what Dokploy issues a certificate for."
  value       = local.project_hostname
}

output "storage_endpoint" {
  description = "S3 API endpoint of the account's R2, which becomes STORAGE_ENDPOINT."
  value       = "https://${var.account_id}.r2.cloudflarestorage.com"
}

output "storage_bucket" {
  description = "Bucket every upload goes in, which becomes STORAGE_BUCKET."
  value       = cloudflare_r2_bucket.project_uploads.name
}

output "storage_access_key_id" {
  description = "R2 derives the S3 access key id from the API token id, which becomes STORAGE_ACCESS_KEY_ID."
  value       = cloudflare_api_token.project_uploads_r2.id
}

output "storage_secret_access_key" {
  description = "R2 derives the S3 secret from the SHA-256 hex of the token value; printed once by the CLI and written to no file."
  value       = sha256(cloudflare_api_token.project_uploads_r2.value)
  sensitive   = true
}

output "dsn_hint" {
  description = "Where the operator copies the project DSN from; the CLI writes it as the comment line above GLITCHTIP_DSN=."
  value       = "Copy the project DSN from GlitchTip: open the project, then Settings, then Keys and DSN, and paste the DSN into GLITCHTIP_DSN in Dokploy."
}
