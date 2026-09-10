# Tool and provider pins for the cloudflare provider module. Both are exact: a module that ships
# inside a published package cannot let a caller's OpenTofu or provider version decide what it
# creates.

terraform {
  required_version = "1.12.6"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "5.24.0"
    }
  }
}

# No credential lives here. The provider reads CLOUDFLARE_API_TOKEN from the environment, which
# hearthkit infra apply supplies to the child process of `tofu apply` only.
provider "cloudflare" {}
