/**
 * A project-scoped exemption from Domain Restricted Sharing.
 *
 * The organisation enforces `iam.allowedPolicyMemberDomains`, which limits every
 * IAM member to the Workspace customer. That forbids `allUsers`, and the gateway
 * must accept `allUsers` for `run.invoker` — Firebase Hosting rewrites call
 * Cloud Run as an anonymous caller, so without it the custom domain cannot reach
 * the API at all.
 *
 * ## What this permits, and what it does not
 *
 * It permits *granting* public IAM inside this one project. It makes nothing
 * public by itself. The only public grant in the entire configuration is
 * `run.invoker` on the gateway; every other service stays
 * INGRESS_TRAFFIC_INTERNAL_ONLY with named-caller-only IAM.
 *
 * Every other project in the organisation stays restricted — the exemption is
 * attached to this project, not to the org.
 *
 * ## Why this is Terraform rather than a console click
 *
 * A security control loosened by hand, once, by someone who has since forgotten,
 * is indistinguishable from one that was never set. As Terraform it is a
 * reviewable diff, it is reproducible, and `terraform plan` reports it if anyone
 * changes it out of band.
 *
 * This is the narrowest form available: the constraint is a list constraint, so
 * a per-project `allow_all` rule is the exemption mechanism. There is no
 * "allow allUsers for Cloud Run only" variant.
 */

resource "google_project_service" "orgpolicy" {
  project = var.project_id
  service = "orgpolicy.googleapis.com"

  disable_on_destroy         = false
  disable_dependent_services = false
}

resource "google_org_policy_policy" "allow_public_invoker" {
  name   = "projects/${var.project_id}/policies/iam.allowedPolicyMemberDomains"
  parent = "projects/${var.project_id}"

  spec {
    inherit_from_parent = false

    rules {
      allow_all = "TRUE"
    }
  }

  depends_on = [google_project_service.orgpolicy]
}
