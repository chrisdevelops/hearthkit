# The five operator inputs @hearthkit/create writes into the project's infra/tofu.tfvars, plus the one
# secret that only ever arrives through the environment. There is no zone or account data source: the
# ids are inputs, which is what lets `tofu plan` run against a dummy token and reach no account.

variable "project_name" {
  description = "Project name; also the DNS record name, the R2 bucket name, and part of the token's per-bucket resource key."
  type        = string

  validation {
    condition     = length(trimspace(var.project_name)) > 0
    error_message = "project_name must not be blank; hearthkit infra apply fills it from infra/tofu.tfvars."
  }
}

variable "zone_name" {
  description = "Apex name of the Cloudflare zone, for example example.com; the hostname is <project_name>.<zone_name>."
  type        = string

  validation {
    condition     = length(trimspace(var.zone_name)) > 0
    error_message = "zone_name must not be blank; hearthkit infra apply fills it from infra/tofu.tfvars."
  }
}

variable "zone_id" {
  description = "Cloudflare zone id from the dashboard overview; an input rather than a lookup so no data source is needed."
  type        = string

  validation {
    condition     = length(trimspace(var.zone_id)) > 0
    error_message = "zone_id must not be blank; hearthkit infra apply fills it from infra/tofu.tfvars."
  }
}

variable "account_id" {
  description = "Cloudflare account id from the dashboard; names the R2 endpoint and the token's resource key."
  type        = string

  validation {
    condition     = length(trimspace(var.account_id)) > 0
    error_message = "account_id must not be blank; hearthkit infra apply fills it from infra/tofu.tfvars."
  }
}

variable "host_ip" {
  description = "IPv4 address of the VPS the DNS A record points at."
  type        = string

  validation {
    condition     = length(trimspace(var.host_ip)) > 0
    error_message = "host_ip must not be blank; hearthkit infra apply fills it from infra/tofu.tfvars."
  }
}

variable "state_passphrase" {
  description = "Passphrase the pbkdf2 key provider derives the state encryption key from; 16 characters or more, supplied as TF_VAR_state_passphrase and never written to a file."
  type        = string
  sensitive   = true
}
