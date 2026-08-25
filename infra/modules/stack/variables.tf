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
