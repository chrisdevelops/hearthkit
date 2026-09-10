# infra/tofu — provider contract (v1: `cloudflare`)

## Purpose

One OpenTofu module per infrastructure provider, all implementing the same inputs and outputs, so `hearthkit infra apply` and a generated project depend on this contract and never on a provider. The v1 implementation is `packages/cli/tofu/cloudflare/`, shipped in the published `@hearthkit/cli` files and selected by `HEARTHKIT_INFRA_PROVIDER=cloudflare`; `infra/tofu/` at the repo root holds only this contract. The cli runs `tofu -chdir=<cli package root>/tofu/cloudflare` with `TF_DATA_DIR=<project>/infra/.terraform`, so the provider cache and `.terraform.lock.hcl` land in the project, never in `node_modules`. Plan sections 3 and 8.2 are amended to these paths in the same PR. For one project it creates exactly four things: a DNS A record pointing the project's hostname at the VPS, an R2 bucket for uploads, one API token scoped to that bucket, and a CORS rule on the bucket so a browser can do a presigned `PUT`. Its outputs become the project's production `STORAGE_*` variables. State lives in a dedicated R2 bucket and is encrypted client-side. HCL is allowed inside a provider module directory and nowhere else. Plan section 8.2 lists three inputs; it is amended to the five below in the same PR.

## Inputs

### Module variables

Five operator-facing variables, written by `@hearthkit/create` to the project's `infra/tofu.tfvars` (`project_name` filled, the other four as `""` placeholders) and passed by the cli with `-var-file`. One secret variable comes only from the environment.

| Variable           | Type              | Where it comes from                                                                                     | Example                            |
| ------------------ | ----------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `project_name`     | string, non-empty | tfvars; the `HearthkitProjectName` the cli contract defines                                             | `myapp`                            |
| `zone_name`        | string, non-empty | tfvars; the Cloudflare zone's apex name                                                                 | `example.com`                      |
| `zone_id`          | string, non-empty | tfvars; the zone id from the Cloudflare dashboard overview                                              | `023e105f4ecef8ad9ca31a8372d0c353` |
| `account_id`       | string, non-empty | tfvars; the account id from the dashboard                                                               | `f037e56e89293a057740de681ac9abbe` |
| `host_ip`          | string, non-empty | tfvars; the VPS IPv4 address                                                                            | `203.0.113.10`                     |
| `state_passphrase` | string, sensitive | `TF_VAR_state_passphrase`, set by the cli from `HEARTHKIT_TOFU_STATE_PASSPHRASE`, 16 characters or more | (never written to a file)          |

`project_name` names three things: the DNS record (`<project_name>.<zone_name>` is the hostname), the R2 bucket, and the token's per-bucket resource key. The module declares no data source: `zone_id` and `account_id` are inputs and the permission-group id is a literal (below), which is what lets a gate run `tofu plan` with a dummy token and no network.

### Provider and tool pins

- `required_providers { cloudflare = { source = "cloudflare/cloudflare", version = "5.24.0" } }` — exact pin, released 2026-08-20.
- `required_version = "1.12.6"` — exact pin. Locally `brew install opentofu`; in CI `opentofu/setup-opentofu@v1` with `tofu_version: 1.12.6` and `tofu_wrapper: false`.
- The provider reads `CLOUDFLARE_API_TOKEN` from the environment; the module declares no token variable.

### Environment the cli must supply, per subcommand

The cli, not the module, holds every secret. It passes them only in child-process environments, never in a file and never into its own `process.env`:

| Subcommand    | `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (state bucket) | `TF_VAR_state_passphrase` | `CLOUDFLARE_API_TOKEN` |
| ------------- | ------------------------------------------------------------ | ------------------------- | ---------------------- |
| `tofu init`   | yes                                                          | yes                       | no                     |
| `tofu apply`  | yes                                                          | yes                       | yes                    |
| `tofu output` | yes                                                          | yes                       | no                     |

The s3 backend opens the state bucket on every command that reads or writes state, and encryption decrypts state on every read, so the state credentials and the passphrase go to all three subcommands. The brief's "init only" wording is corrected here; see Questions.

### State backend

The module's backend block is empty, `backend "s3" {}`; the cli passes every setting as `-backend-config=<key>=<value>` flags to `tofu init` (verified against 1.12.6, see Verified):

| Key                                                                                                                                                    | Value                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `bucket`                                                                                                                                               | `hearthkit-tofu-state` (operator-created, one per account)                                                                  |
| `key`                                                                                                                                                  | `<project_name>.tfstate`                                                                                                    |
| `region`                                                                                                                                               | `auto`                                                                                                                      |
| `endpoints`                                                                                                                                            | `{ s3 = "https://<account_id>.r2.cloudflarestorage.com" }` — the singular `endpoint` argument is deprecated and is not used |
| `skip_credentials_validation`, `skip_region_validation`, `skip_requesting_account_id`, `skip_metadata_api_check`, `skip_s3_checksum`, `use_path_style` | all `true`                                                                                                                  |

### State encryption

```hcl
terraform {
  encryption {
    key_provider "pbkdf2" "state" { passphrase = var.state_passphrase }
    method "aes_gcm" "state"      { keys = key_provider.pbkdf2.state }
    state                         { method = method.aes_gcm.state }
  }
}
```

Validated at 1.12.6. The passphrase must be 16 characters or more; the cli checks the length before any `tofu` process starts.

## Outputs

Exactly six, read by the cli from `tofu output -json` (`.<name>.value`):

| Output                      | Value                                                                                                        | Sensitive | Becomes                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ | --------- | ---------------------------------------------------------------------------- |
| `hostname`                  | `<project_name>.<zone_name>`                                                                                 | no        | reported on the success line                                                 |
| `storage_endpoint`          | `https://<account_id>.r2.cloudflarestorage.com`                                                              | no        | `STORAGE_ENDPOINT`                                                           |
| `storage_bucket`            | `<project_name>`                                                                                             | no        | `STORAGE_BUCKET`                                                             |
| `storage_access_key_id`     | the `cloudflare_api_token` resource's `id`                                                                   | no        | `STORAGE_ACCESS_KEY_ID`                                                      |
| `storage_secret_access_key` | `sha256(cloudflare_api_token.<name>.value)` (hex; R2's documented S3 secret derivation)                      | yes       | `STORAGE_SECRET_ACCESS_KEY`, printed once on stdout, never written to a file |
| `dsn_hint`                  | fixed guidance text: where in GlitchTip to copy the project DSN from; no provider resource can produce a DSN | no        | the comment line above `GLITCHTIP_DSN=`                                      |

`STORAGE_REGION=auto` is written by the cli and is not an output. The cli writes the non-secret four into `.env.production.example`, leaves `STORAGE_SECRET_ACCESS_KEY=` blank there, and prints all five `STORAGE_*` values once for pasting into Dokploy. The exact wording of `dsn_hint` is the implementor's and is not gated; it must name GlitchTip and say "project DSN".

### Resources, exactly four, no data source

1. `cloudflare_dns_record` — `zone_id = var.zone_id`, `name = var.project_name`, `type = "A"`, `content = var.host_ip`, `ttl = 300`, `proxied = false`. DNS-only so Dokploy's Let's Encrypt HTTP-01 works without touching the zone's SSL mode.
2. `cloudflare_r2_bucket` — `account_id = var.account_id`, `name = var.project_name`. No `location`, `jurisdiction`, or `storage_class`.
3. `cloudflare_api_token` — `name = "hearthkit-<project_name>-r2"`, one policy:
   ```hcl
   policies = [{
     effect            = "allow"
     permission_groups = [{ id = "2efd5506f9c8494dacb1fa10a3e7d5b6" }]
     resources         = jsonencode({ "com.cloudflare.edge.r2.bucket.${var.account_id}_default_${var.project_name}" = "*" })
   }]
   ```
   Every literal above carries an HCL comment reading `verified 2026-09-10, GET /client/v4/accounts/{account_id}/tokens/permission_groups` (the id) or `verified 2026-09-10, GET /client/v4/accounts/{account_id}/tokens/{token_id} on a dashboard-created single-bucket R2 token` (the resource key). The token is user-owned (`cfut_` prefix) under the operator's identity, which R2 accepts as S3 credentials the same as an account-owned `cfat_` token.
4. `cloudflare_r2_bucket_cors` — `account_id = var.account_id`, `bucket_name = cloudflare_r2_bucket.<name>.name`, one rule: `allowed = { methods = ["GET", "PUT"], origins = ["https://<hostname>"], headers = ["content-type"] }`, `max_age_seconds = 3600`.

### Cloudflare literals

| Literal                                                            | Meaning                                                                                                        | Scope                           | Produced by, 2026-09-10                                                                                                                                      |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `2efd5506f9c8494dacb1fa10a3e7d5b6`                                 | `Workers R2 Storage Bucket Item Write` — the one the module uses                                               | `com.cloudflare.edge.r2.bucket` | `GET /client/v4/accounts/{account_id}/tokens/permission_groups`                                                                                              |
| `6a018a9f2fc74eb6b293b0c548f38b39`                                 | `Workers R2 Storage Bucket Item Read` — not used; Write covers reads for the dashboard's "Object Read & Write" | `com.cloudflare.edge.r2.bucket` | same call                                                                                                                                                    |
| `bf7481a1826f439697cb59a20b22293e`                                 | `Workers R2 Storage Write` — account-wide; not usable per bucket                                               | `com.cloudflare.api.account`    | same call                                                                                                                                                    |
| `b4992e1108244f5d8bfbd5744320c2e1`                                 | `Workers R2 Storage Read` — account-wide; not used                                                             | `com.cloudflare.api.account`    | same call                                                                                                                                                    |
| `com.cloudflare.edge.r2.bucket.<account_id>_default_<bucket_name>` | per-bucket resource key                                                                                        | policy `resources`              | `GET /client/v4/accounts/{account_id}/tokens/{token_id}` on a dashboard-created one-bucket token; the same ids appear under `/user/tokens/permission_groups` |

## Failure modes

The module has no failure vocabulary of its own; every failure is a nonzero `tofu` exit and the cli reports it as `cli-infra-tofu-failed` with the subcommand and scrubbed stderr. The ways it fails:

| Where                                 | Cause                                                                                                                                                                                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tofu init`                           | state credentials rejected, `hearthkit-tofu-state` bucket absent, provider download blocked, passphrase under 16 characters (tofu's own check, if the cli's is bypassed)                                                                          |
| `tofu apply`                          | `CLOUDFLARE_API_TOKEN` lacks a permission listed under Dependencies (Cloudflare error 10000); bucket name already taken in the account; A record `<project_name>` already exists in the zone; wrong passphrase for existing state (decrypt fails) |
| `tofu output`                         | an output missing from state (a module defect); the cli reports the missing output name in `detail`                                                                                                                                               |
| `tofu validate` / `tofu plan` (gates) | HCL error, wrong provider version, more or fewer than four resource addresses, any data source                                                                                                                                                    |

## Dependencies

- Tools: `tofu` 1.12.6 on PATH (`hearthkit doctor` reports it as `tofu-cli-available`); provider `cloudflare/cloudflare` 5.24.0 downloaded by `tofu init` (gates use a dummy token, so they need registry access but no account).
- Operator, once per account, before the first `hearthkit infra apply`: the R2 bucket `hearthkit-tofu-state`; one R2 token for it, exported as `HEARTHKIT_TOFU_STATE_ACCESS_KEY_ID` / `HEARTHKIT_TOFU_STATE_SECRET_ACCESS_KEY`; a passphrase in `HEARTHKIT_TOFU_STATE_PASSPHRASE`; and a `CLOUDFLARE_API_TOKEN` that, because resource 3 is a user-owned `cloudflare_api_token`, is allowed to do all of: `User / API Tokens / Edit`, `Zone / DNS / Edit` on the zone, `Account / Workers R2 Storage / Edit`.
- Services for gates: none. No Cloudflare account, no network beyond the provider registry. The gates in `packages/cli` run against `packages/cli/tofu/cloudflare`: the validate gate uses `tofu init -backend=false` then `tofu validate`; the plan gate copies the module to a throwaway directory, adds `zz-hearthkit-gate_override.tf` containing `terraform { backend "local" {} }`, runs a normal `tofu init`, then `tofu plan`. `tofu plan` has no `-backend=false`, and after `init -backend=false` a module with `backend "s3" {}` fails plan with "Backend initialization required" (verified on 1.12.6). Both gates reach no account and no state bucket.

## Out of scope

- **A proxied record.** `proxied = false` is one attribute; flipping it needs the zone's SSL mode at Full, which this module does not manage.
- **A second provider.** The interface is the inputs and outputs above; a second module implements the same table.
- **`cloudflare_account_token` instead of `cloudflare_api_token`.** An account-owned token would let the operator's token drop `User / API Tokens / Edit`. Deferred, not blocked: the output names do not say which resource produced them.
- **Creating the state bucket, its token, or the passphrase.** Manual, once per account (brief Q2).
- **Producing a GlitchTip DSN, a Dokploy application, or `.env.production`.** GlitchTip is 6.2; the cli writes only `.env.production.example`, and never a secret into it.
- **Bucket location, jurisdiction, storage class, lifecycle, custom domains.** Additive attributes on resource 2.

## Verified

Checked 2026-09-10 by the orchestrator with the user's real account (API calls named in the literals table) and by the contract-author against public docs:

- Provider 5.24.0 `cloudflare_api_token`: `policies[].effect`, `policies[].permission_groups[].id`, `policies[].resources` is a **string** ("A json object representing the resources"), hence `jsonencode`; read-only `id` and sensitive `value` — https://raw.githubusercontent.com/cloudflare/terraform-provider-cloudflare/v5.24.0/docs/resources/api_token.md. The other three resource schemas are as the orchestrator verified in the session brief (`docs/next-session-infra.md`), not re-fetched here.
- R2 S3 credentials from an API token: access key id is the token id, secret is the SHA-256 hex of the token value, endpoint `https://<account_id>.r2.cloudflarestorage.com` — https://developers.cloudflare.com/r2/api/tokens/.
- OpenTofu 1.12.6 s3 backend: `endpoints = { s3 = ... }` replaces the deprecated `endpoint`; the six skip and path-style flags above are the set `tofu init` accepted against a fake endpoint — https://opentofu.org/docs/language/settings/backends/s3/.
- OpenTofu state encryption `pbkdf2` key provider and `aes_gcm` method, passphrase 16 characters minimum — https://opentofu.org/docs/language/state/encryption/.
- Permission-group ids and the per-bucket resource key: verified with the real account, not derivable from the public permissions reference, which prints names only.

## Decisions

Ruled by the orchestrator on 2026-09-10; no open questions.

1. **State credentials and passphrase on all three subcommands.** The brief said `tofu init` only; the s3 backend authenticates on every state read and write and encryption decrypts on every read, so the table under Inputs corrects it.
2. **Module location.** `packages/cli/tofu/cloudflare/`, shipped with the cli, run with `-chdir` and `TF_DATA_DIR=<project>/infra/.terraform`, as stated under Purpose.
3. **No secret in the example file.** `STORAGE_SECRET_ACCESS_KEY=` stays blank in `.env.production.example`; the five values are printed once.
