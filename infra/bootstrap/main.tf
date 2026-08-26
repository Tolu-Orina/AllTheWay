/**
 * Bootstrap — applied ONCE, by a human with project owner rights.
 *
 * Creates the things every other Terraform root and every CI build depends on:
 * enabled APIs, the remote-state bucket, the image registry, and the
 * least-privilege service accounts CI runs as.
 *
 * Nothing here is environment-specific. dev/prod live in infra/envs/*.
 */

locals {
  # Enabled once for the whole project. Ordering matters only in that
  # serviceusage/cloudresourcemanager must be on before Terraform can enable
  # the rest — if this is a brand-new project, enable those two by hand first.
  services = [
    "cloudresourcemanager.googleapis.com",
    "serviceusage.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "run.googleapis.com",
    "cloudbuild.googleapis.com",
    "artifactregistry.googleapis.com",
    "firestore.googleapis.com",
    "pubsub.googleapis.com",
    "eventarc.googleapis.com",
    "secretmanager.googleapis.com",
    "cloudtrace.googleapis.com",
    "aiplatform.googleapis.com",
    "firebase.googleapis.com",
    "firebasehosting.googleapis.com",
    "storage.googleapis.com",
    "compute.googleapis.com",
    # Screening of untrusted content (Phase 6). The heuristic screener is a
    # floor that catches known phrasings and will miss a paraphrase; this is
    # the layer that is meant to catch the rest.
    "modelarmor.googleapis.com",
  ]

  # Every (service, env) pair gets its own runtime identity. This is what makes
  # the architecture doc's "least-privilege agent identity" real rather than
  # aspirational: orchestrator-dev cannot act as gateway-prod.
  runtime_identities = {
    for pair in setproduct(var.backend_services, var.environments) :
    "${pair[0]}-${pair[1]}" => {
      service = pair[0]
      env     = pair[1]
    }
  }
}

resource "google_project_service" "enabled" {
  for_each = toset(local.services)

  project = var.project_id
  service = each.value

  # Never let a `terraform destroy` switch APIs off underneath running services.
  disable_on_destroy         = false
  disable_dependent_services = false
}

# ---------------------------------------------------------------------------
# Remote state
# ---------------------------------------------------------------------------

resource "google_storage_bucket" "tfstate" {
  name     = var.state_bucket_name
  project  = var.project_id
  location = var.region

  # Versioning is the only realistic recovery path from a corrupted or
  # truncated state file. Do not turn this off.
  versioning { enabled = true }

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.enabled]
}

# ---------------------------------------------------------------------------
# Image registry — ONE repository, shared by both environments.
#
# Per-environment registries would mean prod runs a different image than the
# one dev verified. Same image, different service: that is the whole point.
# ---------------------------------------------------------------------------

resource "google_artifact_registry_repository" "containers" {
  project       = var.project_id
  location      = var.region
  repository_id = "alltheway"
  format        = "DOCKER"
  description   = "Container images for all AllTheWay Cloud Run services."

  depends_on = [google_project_service.enabled]
}

# ---------------------------------------------------------------------------
# Firebase
# ---------------------------------------------------------------------------

resource "google_firebase_project" "this" {
  provider = google-beta
  project  = var.project_id

  depends_on = [google_project_service.enabled]
}

# ---------------------------------------------------------------------------
# CI identities
#
# Two separate accounts so a compromised or buggy web build cannot touch
# Cloud Run, and a backend build cannot publish to Hosting.
# ---------------------------------------------------------------------------

resource "google_service_account" "ci_web" {
  project      = var.project_id
  account_id   = "ci-web"
  display_name = "CI — web (build + Firebase Hosting deploy)"
}

resource "google_service_account" "ci_backend" {
  project      = var.project_id
  account_id   = "ci-backend"
  display_name = "CI — backend (build + push + Cloud Run deploy)"
}

resource "google_project_iam_member" "ci_web" {
  for_each = toset([
    "roles/firebasehosting.admin",
    "roles/logging.logWriter",
    "roles/artifactregistry.reader",

    # Hosting validates the /api/** rewrite target when it finalises a version,
    # which needs run.services.get on the gateway. Without it the deploy uploads
    # every file successfully and then fails at the last step with a 403 that
    # names Cloud Run — not an obvious place to look when the symptom is
    # "hosting deploy failed".
    #
    # viewer, not invoker: this reads the service definition, it never calls it.
    "roles/run.viewer",

    # Reads the Firebase web app config (apiKey, authDomain, appId) at build
    # time so the browser bundle can talk to Firebase Auth. Without it the build
    # produces a bundle with no Firebase config — which used to silently fall
    # back to the development auth adapter and ship a site that authenticated
    # nobody.
    "roles/firebase.viewer",
  ])

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.ci_web.email}"
}

resource "google_project_iam_member" "ci_backend" {
  for_each = toset([
    "roles/run.admin",
    "roles/artifactregistry.writer",
    "roles/logging.logWriter",
  ])

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.ci_backend.email}"
}

# Deploying a Cloud Run service means assigning it a runtime identity, which
# requires actAs on that identity. Granted per-service-account rather than
# project-wide, so ci-backend can only assign the identities we created.
resource "google_service_account" "runtime" {
  for_each = local.runtime_identities

  project      = var.project_id
  account_id   = "run-${each.key}"
  display_name = "Cloud Run runtime — ${each.value.service} (${each.value.env})"
}

resource "google_service_account_iam_member" "ci_backend_act_as" {
  for_each = google_service_account.runtime

  service_account_id = each.value.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.ci_backend.email}"
}

# Runtime identities read images and write telemetry. Nothing else by default —
# per-service grants (Firestore, Pub/Sub, Secret Manager) belong in envs/*.
resource "google_project_iam_member" "runtime_baseline" {
  for_each = {
    for pair in setproduct(keys(local.runtime_identities), [
      "roles/artifactregistry.reader",
      "roles/logging.logWriter",
      "roles/cloudtrace.agent",
      ]) : "${pair[0]}:${pair[1]}" => {
      identity = pair[0]
      role     = pair[1]
    }
  }

  project = var.project_id
  role    = each.value.role
  member  = "serviceAccount:${google_service_account.runtime[each.value.identity].email}"
}

# ---------------------------------------------------------------------------
# Terraform's own CI identity — used by the plan/apply builds.
# ---------------------------------------------------------------------------

resource "google_service_account" "ci_terraform" {
  project      = var.project_id
  account_id   = "ci-terraform"
  display_name = "CI — Terraform plan/apply"
}

resource "google_project_iam_member" "ci_terraform" {
  for_each = toset([
    "roles/editor",
    "roles/iam.securityAdmin",
  ])

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.ci_terraform.email}"
}

resource "google_storage_bucket_iam_member" "ci_terraform_state" {
  bucket = google_storage_bucket.tfstate.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.ci_terraform.email}"
}
