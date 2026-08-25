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
