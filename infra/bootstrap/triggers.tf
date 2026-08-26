/**
 * Cloud Build triggers — 2nd generation.
 *
 * The 1st-gen `github {}` block needs a legacy "repository mapping" created by
 * the old Cloud Build GitHub App console flow. That flow no longer reliably
 * produces one — connecting the repo left no mapping in this project, and every
 * trigger failed with "Repository mapping does not exist". 2nd gen makes the
 * connection and the repository into Terraform resources instead of a console
 * step you have to remember, which is why it is worth the migration.
 *
 * PREREQUISITES (manual, once — see infra/bootstrap/README-ci.md):
 *
 *   1. Install the Cloud Build GitHub App on the repository, and note the
 *      installation id from the URL of the app's settings page.
 *   2. Create a GitHub personal access token with `repo` and `read:user`,
 *      and put it in Secret Manager. The token is never a Terraform variable:
 *      anything passed as a variable is written to state in plaintext.
 *
 * Set `github_app_installation_id` and `github_pat_secret_id` to switch CI on.
 * Until both are set, everything below is skipped and `terraform apply` is
 * still green — a half-created CI setup is worse than an absent one.
 *
 * Branch model: develop -> dev, main -> prod. Path filters keep a web-only
 * change from rebuilding six backend services.
 *
 * There is no long-lived key in the build itself: builds run inside GCP as the
 * service accounts named below. Workload Identity Federation is for runners
 * *outside* GCP (e.g. GitHub Actions), which is not what this is.
 */

data "google_project" "this" {
  project_id = var.project_id
}

locals {
  # Both halves are required. One without the other cannot produce a working
  # connection, so it should produce nothing at all rather than a broken one.
  ci_enabled = var.github_app_installation_id != "" && var.github_pat_secret_id != ""

  branch_by_env = {
    dev  = "^develop$"
    prod = "^main$"
  }

  # One trigger per (service, env), each scoped to its own directory so the
  # monorepo does not rebuild everything on every commit.
  backend_triggers = local.ci_enabled ? {
    for pair in setproduct(var.backend_services, var.environments) :
    "${pair[0]}-${pair[1]}" => {
      service = pair[0]
      env     = pair[1]
    }
  } : {}

  ci_environments = local.ci_enabled ? toset(var.environments) : toset([])
}

# ---------------------------------------------------------------------------
# The connection
#
# Cloud Build reads the PAT as its own service agent, not as the caller. That
# grant is made here rather than by hand so the permission is visible in the
# same diff as the thing that needs it.
# ---------------------------------------------------------------------------

resource "google_secret_manager_secret_iam_member" "cloudbuild_reads_pat" {
  count = local.ci_enabled ? 1 : 0

  project   = var.project_id
  secret_id = var.github_pat_secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:service-${data.google_project.this.number}@gcp-sa-cloudbuild.iam.gserviceaccount.com"
}

resource "google_cloudbuildv2_connection" "github" {
  count = local.ci_enabled ? 1 : 0

  project  = var.project_id
  location = var.region
  name     = "github"

  github_config {
    app_installation_id = tonumber(var.github_app_installation_id)

    authorizer_credential {
      # `latest` on purpose: rotating the token is replacing the secret version,
      # not editing Terraform and applying.
      oauth_token_secret_version = "projects/${var.project_id}/secrets/${var.github_pat_secret_id}/versions/latest"
    }
  }

  depends_on = [
    google_project_service.enabled,
    google_secret_manager_secret_iam_member.cloudbuild_reads_pat,
  ]
}

resource "google_cloudbuildv2_repository" "repo" {
  count = local.ci_enabled ? 1 : 0

  project           = var.project_id
  location          = var.region
  name              = var.github_repo
  parent_connection = google_cloudbuildv2_connection.github[0].name
  remote_uri        = "https://github.com/${var.github_owner}/${var.github_repo}.git"
}

# ---------------------------------------------------------------------------
# Triggers
# ---------------------------------------------------------------------------

resource "google_cloudbuild_trigger" "web" {
  for_each = local.ci_environments

  project     = var.project_id
  location    = var.region
  name        = "web-${each.value}"
  description = "web/ -> Firebase Hosting (${each.value})"

  repository_event_config {
    repository = google_cloudbuildv2_repository.repo[0].id
    push {
      branch = local.branch_by_env[each.value]
    }
  }

  included_files = ["web/**"]
  filename       = "web/cloudbuild.yaml"

  substitutions = {
    _SITE_ID = "alltheway-${each.value}"

    # The build resolves the gateway's own hostname and bakes it into the
    # bundle as VITE_STREAM_ORIGIN. Both the SSE turn stream and the voice
    # socket must bypass Firebase Hosting — it applies an unconfigurable 60s
    # timeout to rewrites (ADR 0001) and cannot carry a WebSocket upgrade at
    # all, which was verified: wss:// through the Hosting domain answers 401,
    # while the same request direct to Cloud Run upgrades.
    _ENV    = each.value
    _REGION = var.region

    # The Web Push public key, baked into the bundle. See the variable for why
    # this is a substitution and not a secret.
    _VAPID_KEY = var.firebase_vapid_key
  }

  # A trigger running as a non-default service account must not write build
  # logs to the legacy bucket; CLOUD_LOGGING_ONLY is set in the build file.
  service_account = google_service_account.ci_web.id

  depends_on = [google_project_service.enabled]
}

resource "google_cloudbuild_trigger" "backend" {
  for_each = local.backend_triggers

  project     = var.project_id
  location    = var.region
  name        = "${each.value.service}-${each.value.env}"
  description = "${each.value.service}/ -> Cloud Run (${each.value.env})"

  repository_event_config {
    repository = google_cloudbuildv2_repository.repo[0].id
    push {
      branch = local.branch_by_env[each.value.env]
    }
  }

  # The service's own directory, plus the shared code its image bakes in.
  #
  # Its own directory alone is not enough, and the gap is invisible: every
  # backend image builds from the repo root and copies shared source into
  # itself — `libs/policy`, `libs/screening` and `libs/agentauth` for the
  # Python services, `services/contracts` for the gateway. A change to any of
  # those changes the image and fires no trigger, so the running container
  # keeps the old copy while the repo looks up to date.
  #
  # Found the hard way: a rewritten Model Armor screener in `libs/screening`
  # was pushed, no build ran, and the deployed services were left holding the
  # previous version — while Terraform had already pointed them at a real
  # template, which the old code answers by raising. Fail-closed made that an
  # outage rather than a hole, but nothing announced it.
  #
  # Deliberately over-broad: any libs change rebuilds every backend service.
  # Rebuilding an image that did not need it costs a few minutes; not
  # rebuilding one that did costs a service running code nobody shipped.
  included_files = [
    "services/${each.value.service}/**",
    "libs/**",
    "services/contracts/**",
  ]
  filename = "services/${each.value.service}/cloudbuild.yaml"

  substitutions = {
    _SERVICE    = each.value.service
    _ENV        = each.value.env
    _REGION     = var.region
    _REGISTRY   = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.containers.repository_id}"
    _RUNTIME_SA = google_service_account.runtime["${each.value.service}-${each.value.env}"].email
  }

  service_account = google_service_account.ci_backend.id

  depends_on = [google_project_service.enabled]
}
