output "service_uris" {
  value = { for k, m in module.service : k => m.uri }
}

output "hosting_site_id" {
  value = module.hosting.site_id
}

output "hosting_default_url" {
  value = module.hosting.default_url
}

output "required_dns_updates" {
  description = "Read after the first apply to obtain the TXT verification value."
  value       = module.hosting.required_dns_updates
}

output "firestore_database" {
  value = google_firestore_database.this.name
}
