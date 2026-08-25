# Core tflint checks Terraform itself; it does not know the Google provider's
# schema unless this plugin is installed. Without it a bogus attribute passes
# lint silently — which is exactly what happened the first time this ran.
plugin "google" {
  enabled = true
  version = "0.36.0"
  source  = "github.com/terraform-linters/tflint-ruleset-google"
}

plugin "terraform" {
  enabled = true
  preset  = "recommended"
}
