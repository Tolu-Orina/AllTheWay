terraform {
  required_version = ">= 1.9.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 6.0"
    }
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # One root, one backend. Environments are separated by WORKSPACE, which is
  # what allows envs/<env>/ to contain nothing but a tfvars file — a backend
  # prefix cannot be a variable, but a workspace namespaces the state for us.
  #
  #   terraform init -backend-config="bucket=$TF_STATE_BUCKET"
  #   terraform workspace select prod || terraform workspace new prod
  #   terraform apply -var-file=envs/prod/terraform.tfvars
  backend "gcs" {
    prefix = "env"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region

  # Some APIs — identitytoolkit and orgpolicy among them — refuse user
  # credentials that carry no quota project, and the provider does not send one
  # unless told to. Without these the call is attributed to Google's shared
  # gcloud project and fails as SERVICE_DISABLED, which reads like a missing API
  # rather than a missing header.
  #
  # `gcloud auth application-default set-quota-project` is not enough: that sets
  # it for the SDK, not for Terraform's provider.
  billing_project       = var.project_id
  user_project_override = true
}

provider "google-beta" {
  project = var.project_id
  region  = var.region

  # Some APIs — identitytoolkit and orgpolicy among them — refuse user
  # credentials that carry no quota project, and the provider does not send one
  # unless told to. Without these the call is attributed to Google's shared
  # gcloud project and fails as SERVICE_DISABLED, which reads like a missing API
  # rather than a missing header.
  #
  # `gcloud auth application-default set-quota-project` is not enough: that sets
  # it for the SDK, not for Terraform's provider.
  billing_project       = var.project_id
  user_project_override = true
}

# Credentials come from the environment (AWS_PROFILE locally, or a
# Secret Manager-sourced credential in CI). Never commit AWS keys.
provider "aws" {
  region = var.aws_region
}
