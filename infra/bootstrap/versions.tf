terraform {
  required_version = ">= 1.9.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    # Firebase resources are beta-only. Pin deliberately: several of these
    # resources have changed shape between minor releases.
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 6.0"
    }
  }

  # Bootstrap creates the very bucket every other root stores its state in, so
  # its first apply necessarily ran on local state. It was then migrated here:
  #
  #   terraform init && terraform apply          # local state, creates the bucket
  #   terraform init -migrate-state              # once the bucket exists
  #
  # A separate prefix from the env roots: bootstrap owns project-wide things
  # (APIs, the bucket itself, CI identities) and must not share a state file
  # with anything a `terraform destroy` of an environment could touch.
  backend "gcs" {
    bucket = "alltheway-rinegan-tfstate"
    prefix = "bootstrap"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region

  # Some APIs — orgpolicy among them — refuse user credentials that carry no
  # quota project, and the provider does not send one unless told to. Without
  # these two lines the call is attributed to Google's shared gcloud project
  # (764086051850) and fails with SERVICE_DISABLED, which reads like a missing
  # API rather than a missing header.
  #
  # `gcloud auth application-default set-quota-project` alone is not enough:
  # that sets it for the SDK, not for Terraform's provider.
  billing_project       = var.project_id
  user_project_override = true
}

provider "google-beta" {
  project = var.project_id
  region  = var.region

  # Some APIs — orgpolicy among them — refuse user credentials that carry no
  # quota project, and the provider does not send one unless told to. Without
  # these two lines the call is attributed to Google's shared gcloud project
  # (764086051850) and fails with SERVICE_DISABLED, which reads like a missing
  # API rather than a missing header.
  #
  # `gcloud auth application-default set-quota-project` alone is not enough:
  # that sets it for the SDK, not for Terraform's provider.
  billing_project       = var.project_id
  user_project_override = true
}
