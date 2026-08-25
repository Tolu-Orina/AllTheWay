/**
 * Root configuration for every environment.
 *
 * The environment is the Terraform WORKSPACE, not a directory. dev and prod run
 * the exact same code with different variable values, so they cannot silently
 * diverge — and envs/<env>/ needs to hold nothing but a tfvars file.
 */

locals {
  env = terraform.workspace
}

# The default workspace is never an environment. Without this, a forgotten
# `terraform workspace select` would apply prod values into default state.
resource "terraform_data" "guard_workspace" {
  lifecycle {
    precondition {
      condition     = contains(["dev", "prod"], local.env)
      error_message = "Workspace must be 'dev' or 'prod' (got '${terraform.workspace}'). Run: terraform workspace select prod || terraform workspace new prod"
    }
  }
}

data "terraform_remote_state" "bootstrap" {
  backend = "gcs"
  config = {
    bucket = var.state_bucket
    prefix = "bootstrap"
  }
}

module "stack" {
  source = "./modules/stack"

  model_armor_template = var.model_armor_template

  providers = {
    google      = google
    google-beta = google-beta
    aws         = aws
  }

  project_id         = var.project_id
  region             = var.region
  env                = local.env
  firestore_location = var.firestore_location

  # Vertex is deliberately NOT var.region. `global` is where the current Gemini
  # Flash models are reachable, and it is independent of where Cloud Run runs —
  # so the services sit in europe-west1 while model calls go to `global`.
  # Pinned here rather than left to a code default, so the deployed value is
  # reviewable in Terraform instead of discovered by reading env.ts.
  common_env_vars = {
    GOOGLE_CLOUD_LOCATION = "global"
  }

  runtime_service_accounts = data.terraform_remote_state.bootstrap.outputs.runtime_service_accounts

  hosting_site_id         = var.hosting_site_id
  custom_domain           = var.custom_domain
  route53_zone_name       = var.route53_zone_name
  domain_verification_txt = var.domain_verification_txt

  depends_on = [terraform_data.guard_workspace]
}
