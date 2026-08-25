variable "project_id" { type = string }
variable "region" { type = string }

variable "env" {
  type = string
  # Authoritative check lives in the root precondition
  # (terraform_data.guard_workspace) so that `terraform validate`
  # still runs in the default workspace.
}

variable "firestore_location" {
  description = "Firestore location. Cannot be changed after creation."
  type        = string
  default     = "eur3"
}

variable "runtime_service_accounts" {
  description = "Map of \"<service>-<env>\" => SA email, from the bootstrap root."
  type        = map(string)
}

variable "hosting_site_id" { type = string }
variable "custom_domain" { type = string }
variable "route53_zone_name" { type = string }

variable "domain_verification_txt" {
  type    = string
  default = ""
}

variable "prod_min_instances" {
  description = "Set to 1 only if cold starts on the gateway become a real problem — it removes scale-to-zero and its cost saving."
  type        = number
  default     = 0
}

variable "common_env_vars" {
  type    = map(string)
  default = {}
}

variable "model_armor_template" {
  description = "Model Armor template resource name used to screen untrusted content. Empty falls back to the local screener, which is a development posture rather than a production one."
  type        = string
  default     = ""
}

variable "gemini_model" {
  description = <<-EOT
    Vertex model id. Pinned, never 'latest' — a silent swap changes agent
    behaviour.

    3.7-flash, measured against this project on 2026-08-25 rather than chosen by
    version number:

      median latency   3691ms vs 4802ms for 3.6 (n=5, same prompt)
      spread           3311-5264ms vs 2923-7111ms — the tighter max matters
                       more than the median for someone watching a plan build
      schema validity  5/5 both
      gate behaviour   identical on clear / vague / acting prompts
      action labelling identical, and identically unreliable — see below

    Both models flagged an irreversible action in only 8/12 runs on explicitly
    risky requests ("pay the invoice", "delete the draft and send"). The confirm
    gate reads that field, so a third of the time it would not fire. That is a
    prompt and validation problem, not a model choice: switching does not fix it
    and staying does not avoid it.
  EOT
  type        = string
  default     = "gemini-3.7-flash"
}

variable "google_oauth_secrets" {
  description = <<-EOT
    Secret Manager secret *names* holding the OAuth client id and secret for
    Google sign-in. Null disables the provider.

    Names, not values: the consent screen and OAuth client are console-only
    flows, so these are created by hand and referenced here. Passing the
    credentials themselves would put them in tfvars and in every plan output.

    Left null, email and password still work and the Google button fails with a
    provider error rather than silently doing nothing.
  EOT
  type = object({
    client_id     = string
    client_secret = string
  })
  default = null
}

variable "resend_api_key_secret" {
  description = <<-EOT
    Secret Manager secret name holding the Resend API key. Empty leaves the
    gateway's mailer unconfigured.

    Unconfigured is a real, safe state: createMailer() returns a mailer that
    throws on send rather than one that logs codes to stdout, so email routes
    fail loudly and every other route keeps working.
  EOT
  type        = string
  default     = ""
}

variable "mail_from" {
  description = <<-EOT
    The From address for verification and reset mail, e.g.
    "AllTheWay <no-reply@rinegansolutions.com>".

    Its domain must be verified in Resend or delivery is rejected at send time.
  EOT
  type        = string
  default     = ""
}
