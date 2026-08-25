variable "project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "env" {
  description = "dev or prod. Suffixes the service name and gates deletion protection."
  type        = string

  # Authoritative check lives in the root precondition
  # (terraform_data.guard_workspace) so that `terraform validate`
  # still runs in the default workspace.
}

variable "service_name" {
  description = "Base name, e.g. gateway. The env suffix is added automatically."
  type        = string
}

variable "image" {
  description = <<-EOT
    Initial image. CI overwrites this on every deploy and Terraform ignores
    subsequent drift, so this value only matters for the very first apply.
    A placeholder keeps `terraform apply` runnable before any build exists.
  EOT
  type        = string
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}

variable "runtime_service_account" {
  description = "Email of the per-service, per-env identity from bootstrap."
  type        = string
}

variable "allow_unauthenticated" {
  description = "True only for the gateway. Everything else is internal-only."
  type        = bool
  default     = false
}

variable "invoker_service_accounts" {
  description = "Identities permitted to invoke this service internally."
  type        = list(string)
  default     = []
}

variable "min_instances" {
  type    = number
  default = 0
}

variable "max_instances" {
  type    = number
  default = 10
}

variable "concurrency" {
  type    = number
  default = 40
}

variable "timeout_seconds" {
  type    = number
  default = 300
}

variable "cpu" {
  type    = string
  default = "1"
}

variable "memory" {
  type    = string
  default = "512Mi"
}

variable "env_vars" {
  description = "Plain environment variables. Never put secrets here."
  type        = map(string)
  default     = {}
}

variable "secret_env_vars" {
  description = "Map of env var name => Secret Manager secret id."
  type        = map(string)
  default     = {}
}
