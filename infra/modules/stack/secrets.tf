/**
 * Secrets that were created by hand, and how services reach them.
 *
 * Three values cannot be produced by Terraform:
 *
 *  - the Google OAuth client id and secret, because the consent screen is a
 *    console-only flow
 *  - the Resend API key, because it is issued by a third party
 *  - the Stripe secret key and webhook signing secret, because they are
 *    issued by a third party
 *
 * They live in Secret Manager, created out of band. Terraform references them
 * by *name* and never holds the value in a variable, which keeps them out of
 * tfvars, out of shell history, and out of anything a `terraform plan` prints.
 *
 * The two OAuth values are read here because Identity Platform needs them as
 * literal strings in its own config — they are not container env vars. The
 * Resend key is the opposite: it is only ever needed inside the gateway
 * process, so it is mounted as a secret env var and its plaintext never
 * reaches Terraform state at all. Prefer that shape wherever the API allows it.
 */

# Reading a secret version puts its plaintext in state. Unavoidable for these
# two: google_identity_platform_default_supported_idp_config takes strings.
# State lives in a bucket with uniform bucket-level access and no public
# reader, which is what makes that acceptable rather than fine.
data "google_secret_manager_secret_version" "google_oauth_client_id" {
  count = var.google_oauth_secrets == null ? 0 : 1

  project = var.project_id
  secret  = var.google_oauth_secrets.client_id
}

data "google_secret_manager_secret_version" "google_oauth_client_secret" {
  count = var.google_oauth_secrets == null ? 0 : 1

  project = var.project_id
  secret  = var.google_oauth_secrets.client_secret
}

# Per-secret, not project-wide.
#
# The connector gateway holds roles/secretmanager.secretAccessor across the
# whole project, with a note saying that is more than it needs. This is that
# note taken seriously for the one binding being added today: the gateway can
# read the mail key and nothing else, so a future secret is not automatically
# readable by a service that has no business with it.
# The gateway exchanges the authorization code itself, so it needs the OAuth
# client. Per-secret, like the mail key: it can read these two and nothing else.
resource "google_secret_manager_secret_iam_member" "gateway_reads_oauth_client" {
  for_each = var.google_oauth_secrets == null ? toset([]) : toset([
    var.google_oauth_secrets.client_id,
    var.google_oauth_secrets.client_secret,
  ])

  project   = var.project_id
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${local.runtime_sa["gateway-${var.env}"]}"
}

resource "google_secret_manager_secret_iam_member" "gateway_reads_resend_key" {
  count = var.resend_api_key_secret == "" ? 0 : 1

  project   = var.project_id
  secret_id = var.resend_api_key_secret
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${local.runtime_sa["gateway-${var.env}"]}"
}

resource "google_secret_manager_secret_iam_member" "gateway_reads_stripe" {
  for_each = toset(compact([
    var.stripe_secret_key_secret,
    var.stripe_webhook_secret,
  ]))

  project   = var.project_id
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${local.runtime_sa["gateway-${var.env}"]}"
}

# The card signing keypair, readable only by the services that serve a card.
#
# Per-secret and per-service: the gateway signs nothing and is deliberately not
# on this list, so a bug there cannot produce a card that verifies.
resource "google_secret_manager_secret_iam_member" "card_keys" {
  for_each = merge(
    {
      for pair in setproduct(
        # Derived from the same list the env vars come from. Hardcoded, it
        # drifted the moment librarian and scribe joined that list: the
        # revision mounted a secret its own identity could not read, and the
        # apply failed with "Permission denied on secret" — which reads as a
        # missing grant rather than as two lists disagreeing.
        local.card_signing_services,
        ["agentcard_signing_key", "agentcard_public_key"],
      ) : "${pair[0]}:${pair[1]}" => { service = pair[0], secret = pair[1] }
    },
    # The registry gets the public key and nothing else. A registry that could
    # sign could manufacture a trusted entry for an agent nobody deployed.
    {
      "registry:agentcard_public_key" = {
        service = "registry"
        secret  = "agentcard_public_key"
      }
    },
  )

  project   = var.project_id
  secret_id = each.value.secret
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${local.runtime_sa["${each.value.service}-${var.env}"]}"
}

# Scope-token keys: the gateway signs, the librarian verifies, and neither can
# do the other's job. A librarian that could mint would be a librarian that can
# name its own user, which is precisely what layer 4 forbids.
resource "google_secret_manager_secret_iam_member" "scope_token_signer" {
  project   = var.project_id
  secret_id = "scopetoken_signing_key"
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${local.runtime_sa["gateway-${var.env}"]}"
}

resource "google_secret_manager_secret_iam_member" "scope_token_verifier" {
  project   = var.project_id
  secret_id = "scopetoken_public_key"
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${local.runtime_sa["librarian-${var.env}"]}"
}
