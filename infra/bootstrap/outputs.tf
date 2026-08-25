output "tfstate_bucket" {
  description = "Put this in the backend block of every env root, and of bootstrap itself."
  value       = google_storage_bucket.tfstate.name
}

output "artifact_registry" {
  description = "Docker repo host path for image tags."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.containers.repository_id}"
}

output "ci_web_service_account" {
  value = google_service_account.ci_web.email
}

output "ci_backend_service_account" {
  value = google_service_account.ci_backend.email
}

output "ci_terraform_service_account" {
  value = google_service_account.ci_terraform.email
}

output "runtime_service_accounts" {
  description = "Keyed by \"<service>-<env>\"."
  value       = { for k, v in google_service_account.runtime : k => v.email }
}
