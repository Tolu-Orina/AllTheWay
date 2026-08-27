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
  description = "Instances kept warm in prod for the services named in `warm_services`. Everything else still scales to zero."
  type        = number
  default     = 1
}

variable "warm_services" {
  description = "Services that must never be cold in prod. Everything else scales to zero."
  type        = set(string)

  # The gateway only, and deliberately.
  #
  # Cold starts stopped being theoretical: p50 on every endpoint was under a
  # tenth of a second while p95 sat between four and ten, and the logs put an
  # instance finishing startup five seconds after the request that woke it. A
  # person signing in met that on their first tap.
  #
  # The gateway is enough because the screen shown straight after sign-in --
  # digest, sessions, watcher runs, preferences -- is served by the gateway out
  # of Firestore and touches no other service. Warming all nine would multiply
  # the idle cost to remove a delay nobody is waiting on: the librarian and the
  # scribe are reached only by a deliberate navigation, where `startup_cpu_boost`
  # is the cheaper answer.
  default = ["gateway"]
}

variable "common_env_vars" {
  type    = map(string)
  default = {}
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

variable "digest_time_zone" {
  description = <<-EOT
    Time zone the daily digest fires in.

    A morning digest is a local idea, and one zone for everyone is a known
    simplification rather than an oversight: it is right for a single-region
    team and wrong the moment there is a user in Lagos and one in Vancouver.
    Fixing it properly means a per-user send time, which is a scheduling
    problem rather than a configuration one — recorded here so the limitation
    is visible instead of implied.
  EOT
  type        = string
  default     = "Europe/London"
}

variable "meeting_transcribe_model" {
  description = <<-EOT
    Live transcription model for meetings captured by the browser extension.

    Pinned, never 'latest'. Verified against the live endpoint on 2026-08-27:
    the Live setup is answered with setupComplete at `global`.

    Served only at `global`, which is the opposite of the voice Live model and
    the reason meeting transcription does not share GOOGLE_CLOUD_LIVE_LOCATION.

    Accepts ten minutes of audio per session, so the gateway rotates sessions
    underneath a long meeting rather than letting one hit the limit.
  EOT
  type        = string
  default     = "gemini-3.5-transcribe-live-preview"
}

variable "media_location" {
  description = <<-EOT
    Where image and video generation runs.

    Deliberately its own variable rather than reusing GOOGLE_CLOUD_LOCATION or
    the Live location. Both of those already had to be split apart once for the
    same reason: the models a location offers differ per model family, and one
    variable standing for three answers is how voice went to `global` and got
    "Publisher model was not found" on every session.

    The image and Veo models are `global`-only today. That is worth stating
    here because it is the open question for EU data residency: pinning this to
    a European region is the lever, and it will fail until those models are
    offered there.
  EOT
  type        = string
  default     = "global"
}

variable "gemini_live_model" {
  description = <<-EOT
    Live API model id on Vertex. Pinned, never 'latest'.

    gemini-live-2.5-flash-native-audio is the GA native-audio Live model on
    Agent Platform / Vertex. gemini-3.1-flash-live-preview is Gemini Developer
    API only and is not available on Vertex.
  EOT
  type        = string
  default     = "gemini-live-2.5-flash-native-audio"
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

variable "stripe_secret_key_secret" {
  description = <<-EOT
    Secret Manager secret name holding the Stripe secret key. Empty leaves
    checkout, portal, and the webhook unconfigured (503), which is a supported
    local and two-phase-apply state. Names, never values.
  EOT
  type        = string
  default     = ""
}

variable "stripe_webhook_secret" {
  description = <<-EOT
    Secret Manager secret name holding the Stripe webhook signing secret.
    Empty leaves the webhook unconfigured. Names, never values.
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
