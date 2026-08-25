terraform {
  required_version = ">= 1.9.0"

  required_providers {
    google-beta = {
      source                = "hashicorp/google-beta"
      version               = "~> 6.0"
      configuration_aliases = [google-beta]
    }
    # DNS for rinegansolutions.com lives in Route 53. Managing the record here,
    # next to the Hosting site that requires it, is the whole point: the domain
    # cannot silently drift from what Firebase expects.
    aws = {
      source                = "hashicorp/aws"
      version               = "~> 5.0"
      configuration_aliases = [aws]
    }
  }
}
