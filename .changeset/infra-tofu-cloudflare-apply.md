---
'@hearthkit/cli': minor
'@hearthkit/create': minor
---

Add `hearthkit infra apply` and the Cloudflare OpenTofu provider module (completion plan step 6.1).

`@hearthkit/cli` ships the module at `tofu/cloudflare/` (DNS A record, R2 bucket, bucket-scoped API token, CORS rule, encrypted state in R2), runs it with `tofu` 1.12.6 pinned, checks the provider, the four secret variables, `infra/tofu.tfvars` and `.env.production.example` before any `tofu` process starts, rewrites the non-secret `STORAGE_*` lines in place and prints all five once. `hearthkit doctor` gains `tofu-cli-available`.

`@hearthkit/create` writes `infra/tofu.tfvars` with `zone_name`, `zone_id`, `account_id` and `host_ip` placeholders and copies `.env.production.example` from the template.
