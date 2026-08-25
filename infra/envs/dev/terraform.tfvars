# Applied with: terraform workspace select dev && terraform apply -var-file=envs/dev/terraform.tfvars
project_id   = "alltheway-rinegan"
state_bucket = "alltheway-rinegan-tfstate"

hosting_site_id = "alltheway-dev"
custom_domain   = "dev.alltheway.rinegansolutions.com"

domain_verification_txt = ""

firestore_location = "europe-west1"
