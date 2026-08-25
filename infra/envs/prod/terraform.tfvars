# Applied with: terraform workspace select prod && terraform apply -var-file=envs/prod/terraform.tfvars
project_id   = "alltheway-rinegan"
state_bucket = "alltheway-rinegan-tfstate"

hosting_site_id = "alltheway-prod"
custom_domain   = "alltheway.rinegansolutions.com"

# Two-phase: empty on the first apply, then set from
# `terraform output required_dns_updates` and apply again.
domain_verification_txt = ""

# Single region, matching Cloud Run. PERMANENT once the database exists.
firestore_location = "europe-west1"

# Secret Manager secret *names*, created by hand. The values are never here.
google_oauth_secrets = {
  client_id     = "google_oauth_client_id"
  client_secret = "google_oauth_client_secret"
}

resend_api_key_secret = "RESEND_API_KEY"

# The sending domain must be verified in Resend (DNS records on
# rinegansolutions.com) or every send is rejected at the API.
mail_from = "AllTheWay <no-reply@rinegansolutions.com>"
