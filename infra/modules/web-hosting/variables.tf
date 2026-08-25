variable "project_id" {
  type = string
}

variable "site_id" {
  description = "Firebase Hosting site id. Must be globally unique, e.g. alltheway-prod."
  type        = string
}

variable "custom_domain" {
  description = "Fully-qualified domain, e.g. alltheway.rinegansolutions.com."
  type        = string
}

variable "route53_zone_name" {
  description = "Route 53 hosted zone, with trailing dot, e.g. rinegansolutions.com."
  type        = string
}

variable "hosting_a_records" {
  description = <<-EOT
    Firebase Hosting's published A records.

    These are stable and documented, but VERIFY them against what the Firebase
    console shows for this specific site before the first apply — if Google ever
    rotates them, a stale value here silently breaks the domain.
  EOT
  type        = list(string)
  default     = ["151.101.1.195", "151.101.65.195"]
}

variable "domain_verification_txt" {
  description = <<-EOT
    TXT value Firebase issues to prove domain ownership.

    Unknown until the custom domain resource exists, so this is a deliberate
    two-phase apply:
      1. apply with this empty  -> creates the site + custom domain
      2. read the value Firebase issues, set it here, apply again -> writes the
         TXT record and the domain finishes verifying
    Leave empty and no TXT record is created.
  EOT
  type        = string
  default     = ""
}
