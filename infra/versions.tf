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
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}

# Credentials come from the environment (AWS_PROFILE locally, or a
# Secret Manager-sourced credential in CI). Never commit AWS keys.
provider "aws" {
  region = var.aws_region
}
