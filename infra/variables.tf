variable "project_id" {
  description = "The single GCP project hosting both environments."
  type        = string
}

variable "state_bucket" {
  description = "Terraform state bucket, from the bootstrap outputs."
  type        = string
}

variable "region" {
  description = <<-EOT
    Must match the region in web/firebase.json's /api/** rewrite, or the
    Hosting rewrite will not resolve the gateway service.
  EOT
  type        = string
  default     = "europe-west1"
}

variable "aws_region" {
  description = "Route 53 is global, but the AWS provider still requires a region."
  type        = string
  default     = "eu-west-1"
}

variable "hosting_site_id" {
  description = "Firebase Hosting site id. Globally unique."
  type        = string
}

variable "custom_domain" {
  type = string
}

variable "route53_zone_name" {
  type    = string
  default = "rinegansolutions.com"
}

variable "domain_verification_txt" {
  description = "Set on the second apply; see infra/README.md."
  type        = string
  default     = ""
}

variable "model_armor_template" {
  description = "Model Armor template resource name for screening untrusted content."
  type        = string
  default     = ""
}
