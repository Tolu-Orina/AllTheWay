/**
 * Cloud Build triggers.
 *
 * PREREQUISITE (manual, once): connect the GitHub repository to Cloud Build via
 * the Cloud Build GitHub App — Console > Cloud Build > Triggers > Connect
 * repository. These resources reference that connection; they do not create it.
 * There is no long-lived key anywhere: the build runs inside GCP as the service
 * account named below, which is why Workload Identity Federation is not needed
 * here (WIF is for runners *outside* GCP, e.g. GitHub Actions).
 *
 * Branch model: develop -> dev, main -> prod. Path filters keep a web-only
 * change from rebuilding five backend services.
 */

locals {
  branch_by_env = {
    dev  = "^develop$"
    prod = "^main$"
  }

  # One trigger per (service, env). Each is scoped to its own directory so the
  # monorepo does not rebuild everything on every commit.
  backend_triggers = {
    for pair in setproduct(var.backend_services, var.environments) :
    "${pair[0]}-${pair[1]}" => {
      service = pair[0]
      env     = pair[1]
    }
  }
}

resource "google_cloudbuild_trigger" "web" {
  for_each = toset(var.environments)

  project     = var.project_id
  location    = var.region
  name        = "web-${each.value}"
  description = "web/ -> Firebase Hosting (${each.value})"

  github {
    owner = var.github_owner
    name  = var.github_repo
    push {
      branch = local.branch_by_env[each.value]
    }
  }

  included_files = ["web/**"]
  filename       = "web/cloudbuild.yaml"

  substitutions = {
    _SITE_ID = "alltheway-${each.value}"
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

  github {
    owner = var.github_owner
    name  = var.github_repo
    push {
      branch = local.branch_by_env[each.value.env]
    }
  }

  included_files = ["services/${each.value.service}/**"]
  filename       = "services/${each.value.service}/cloudbuild.yaml"

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
