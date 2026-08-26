variable "project_id" {
  description = "The single GCP project that hosts both dev and prod."
  type        = string
}

variable "region" {
  description = <<-EOT
    Primary region for Cloud Run, Artifact Registry and the state bucket.
    This MUST match the `region` in web/firebase.json's /api/** rewrite,
    otherwise the Hosting rewrite will not resolve the gateway service.
  EOT
  type        = string
  default     = "europe-west1"
}

variable "state_bucket_name" {
  description = "Globally unique name for the Terraform state bucket."
  type        = string
}

variable "github_owner" {
  description = "GitHub org or user that owns the repository."
  type        = string
}

variable "github_repo" {
  description = "Repository name, without the owner prefix."
  type        = string
}

variable "backend_services" {
  description = "Cloud Run service base names, used to pre-create runtime service accounts."
  type        = list(string)
  default = [
    "gateway",
    "orchestrator",
    "research-cell",
    "profile-synthesizer",
    "watcher-runtime",
    # Added in Phase 6. Missing here meant its runtime identity was never
    # created, so the first deploy of the Agent Gateway would fail on a
    # service account that does not exist.
    "connector-gateway",
    # Added in Phase 7. Same lesson as the line above: a service absent here has
    # no runtime identity, and its first deploy fails on a service account that
    # does not exist.
    "registry",
    # Added in v3 Phase B. Same lesson as the two lines above: a service absent
    # here has no runtime identity and its first deploy fails.
    "librarian",
  ]
}

variable "environments" {
  description = "Environment suffixes. One GCP project, separated by resource naming."
  type        = list(string)
  default     = ["dev", "prod"]
}

# ---------------------------------------------------------------------------
# CI (2nd-gen Cloud Build). Both must be set for triggers to be created; either
# alone produces nothing, because a half-configured connection is worse than
# none. See the header of triggers.tf.
# ---------------------------------------------------------------------------

variable "github_app_installation_id" {
  description = "Cloud Build GitHub App installation id, from the app settings URL. Empty disables CI triggers."
  type        = string
  default     = ""
}

variable "github_pat_secret_id" {
  description = <<-EOT
    Secret Manager secret ID (not the value) holding a GitHub PAT with `repo`
    and `read:user`. The token is deliberately not a Terraform variable —
    variables are written to state in plaintext. Empty disables CI triggers.
  EOT
  type        = string
  default     = ""
}
