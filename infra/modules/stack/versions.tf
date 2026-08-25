terraform {
  required_version = ">= 1.9.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    google-beta = {
      source                = "hashicorp/google-beta"
      version               = "~> 6.0"
      configuration_aliases = [google-beta]
    }
    aws = {
      source                = "hashicorp/aws"
      version               = "~> 5.0"
      configuration_aliases = [aws]
    }
  }
}
