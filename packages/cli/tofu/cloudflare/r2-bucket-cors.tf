# What a browser is allowed to do against the bucket directly: a presigned PUT to upload and a GET to
# read back, from this project's hostname and nowhere else. content-type is allowed because a
# presigned PUT sends it.

resource "cloudflare_r2_bucket_cors" "project_uploads_browser" {
  account_id  = var.account_id
  bucket_name = cloudflare_r2_bucket.project_uploads.name

  rules = [{
    id = "hearthkit-${var.project_name}-browser-uploads"
    allowed = {
      methods = ["GET", "PUT"]
      origins = ["https://${local.project_hostname}"]
      headers = ["content-type"]
    }
    max_age_seconds = 3600
  }]
}
