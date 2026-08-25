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

  # Intentionally NO backend block.
  #
  # Bootstrap creates the very bucket that every other root stores its state in,
  # so it cannot store its own state there on the first apply. Run it locally,
  # then migrate:
  #
  #   terraform init && terraform apply          # local state, creates the bucket
  #   # uncomment the backend block below, then:
  #   terraform init -migrate-state
  #
  # backend "gcs" {
  #   bucket = "REPLACE-WITH-tfstate_bucket-OUTPUT"
  #   prefix = "bootstrap"
  # }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}
