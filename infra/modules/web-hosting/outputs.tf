output "site_id" {
  description = "Pass to `firebase deploy --only hosting:<site_id>` in CI."
  value       = google_firebase_hosting_site.this.site_id
}

output "default_url" {
  description = "Firebase-provided URL, useful before DNS propagates."
  value       = google_firebase_hosting_site.this.default_url
}

output "custom_domain" {
  value = google_firebase_hosting_custom_domain.this.custom_domain
}

output "required_dns_updates" {
  description = <<-EOT
    What Firebase still wants in DNS. After the first apply, read this to get
    the TXT verification value, then set `domain_verification_txt` and re-apply.
  EOT
  value       = google_firebase_hosting_custom_domain.this.required_dns_updates
}
