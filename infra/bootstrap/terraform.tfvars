# Applied ONCE, by a human with project owner rights.
#
#   terraform init && terraform apply          # local state, creates the bucket
#   # then uncomment the backend block in versions.tf and:
#   terraform init -migrate-state
#
# Nothing here is secret: a project id, a bucket name and a repo name. It is
# committed so the values that every other root depends on are reviewable.

project_id        = "alltheway-rinegan"
state_bucket_name = "alltheway-rinegan-tfstate"

github_owner = "Tolu-Orina"
github_repo  = "AllTheWay"

# CI (2nd-gen Cloud Build). The installation id is public-ish and harmless; the
# PAT itself lives in Secret Manager and is referenced by name only, so no token
# is ever written to a file or to Terraform state.
github_app_installation_id = "156485111"
github_pat_secret_id       = "github-pat"

# europe-west1 must match the /api/** rewrite region in firebase.json, or the
# Hosting rewrite will not resolve the gateway.
region = "europe-west1"
