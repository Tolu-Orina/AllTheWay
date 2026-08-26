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

variable "firestore_location" {
  description = <<-EOT
    Firestore location. CANNOT BE CHANGED after the database is created, so it
    is a root variable rather than a module default — the value that is fixed
    forever should be visible in the tfvars a human reviews.

    A single region (europe-west1) matches Cloud Run and gives lower write
    latency and cost than a multi-region (eur3), at the price of regional rather
    than multi-region redundancy.
  EOT
  type        = string
  default     = "europe-west1"
}

variable "google_oauth_secrets" {
  description = "Secret Manager secret names for the Google sign-in OAuth client. Null disables the provider. See modules/stack/variables.tf."
  type = object({
    client_id     = string
    client_secret = string
  })
  default = null
}

variable "resend_api_key_secret" {
  description = "Secret Manager secret name holding the Resend API key. Empty leaves the mailer unconfigured."
  type        = string
  default     = ""
}

variable "mail_from" {
  description = "From address for verification and reset mail. Its domain must be verified in Resend."
  type        = string
  default     = ""
}
