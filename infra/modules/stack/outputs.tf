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

# What the browser needs to talk to Firebase Auth. Consumed by the web build,
# which bakes them in as VITE_* at compile time — these are public values by
# design (an API key here identifies the project, it does not authorise
# anything; access is controlled by Firebase security rules and by the
# gateway verifying ID tokens).
output "firebase_web_config" {
  description = "Firebase web app config for the browser SDK."
  value = {
    apiKey     = data.google_firebase_web_app_config.this.api_key
    authDomain = data.google_firebase_web_app_config.this.auth_domain
    projectId  = var.project_id
    appId      = google_firebase_web_app.this.app_id
  }
}
