output "environment" {
  value = local.env
}

output "service_uris" {
  value = module.stack.service_uris
}

output "hosting_site_id" {
  value = module.stack.hosting_site_id
}

output "hosting_default_url" {
  description = "Reachable before DNS propagates — useful for smoke tests."
  value       = module.stack.hosting_default_url
}

output "required_dns_updates" {
  description = "Read after the first apply to obtain the TXT verification value."
  value       = module.stack.required_dns_updates
}

output "firestore_database" {
  value = module.stack.firestore_database
}

output "firebase_web_config" {
  description = "Firebase web app config. Feed these to the web build as VITE_* variables."
  value       = module.stack.firebase_web_config
}
