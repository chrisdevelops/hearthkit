# The project's upload bucket. No location, jurisdiction or storage class: each is an additive
# attribute, and location in particular is honoured only the first time a bucket of a given name is
# created, so setting it here would quietly do nothing on a recreate.

resource "cloudflare_r2_bucket" "project_uploads" {
  account_id = var.account_id
  name       = var.project_name
}
