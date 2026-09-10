# State is encrypted client side before it reaches R2, so a readable object in the state bucket is
# still not a readable state file. The passphrase arrives as TF_VAR_state_passphrase in the child
# environment of every tofu run; hearthkit infra apply refuses to start below 16 characters, which is
# the pbkdf2 key provider's own minimum.

terraform {
  encryption {
    key_provider "pbkdf2" "state" {
      passphrase = var.state_passphrase
    }

    method "aes_gcm" "state" {
      keys = key_provider.pbkdf2.state
    }

    state {
      method = method.aes_gcm.state
    }
  }
}
