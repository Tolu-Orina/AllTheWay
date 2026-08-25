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
  ]
}

variable "environments" {
  description = "Environment suffixes. One GCP project, separated by resource naming."
  type        = list(string)
  default     = ["dev", "prod"]
}
