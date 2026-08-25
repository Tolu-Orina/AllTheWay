/**
 * One Firebase Hosting site plus the Route 53 records that point at it.
 *
 * Terraform owns the *site*; it does not own the site's *content*. Deploying
 * `dist/` stays a CI step (`firebase deploy --only hosting`). Infrastructure
 * and artifacts are different lifecycles and should not share a pipeline.
 *
 * ## CNAME for a subdomain, A records only at the apex
 *
 * Firebase accepts either, but it asks for a CNAME to `<site>.web.app` and
 * reports A records as records to REMOVE — visible in the custom domain's
 * `required_dns_updates`, which is Firebase's own view of what it expects.
 * Until DNS matches that, the domain stays pending and no certificate is
 * issued.
 *
 * A records are used only at a zone apex, where CNAME is illegal per RFC 1034.
 * That is decided here rather than configured, because getting it wrong is not
 * a preference — it is a broken domain.
 *
 * The CNAME target is derived from the site id, so it cannot drift from the
 * site this module actually created. The hardcoded A records remain for the
 * apex case and carry their own warning: if Google rotates them, a stale value
 * silently breaks the domain.
 */

resource "google_firebase_hosting_site" "this" {
  provider = google-beta

  project = var.project_id
  site_id = var.site_id
}

resource "google_firebase_hosting_custom_domain" "this" {
  provider = google-beta

  project       = var.project_id
  site_id       = google_firebase_hosting_site.this.site_id
  custom_domain = var.custom_domain

  # Firebase provisions and renews the certificate itself.
  cert_preference = "GROUPED"

  # The DNS records below are what make this resolve; without them the domain
  # sits in a pending state indefinitely rather than failing loudly.
  wait_dns_verification = false
}

data "aws_route53_zone" "this" {
  provider = aws

  name         = var.route53_zone_name
  private_zone = false
}

locals {
  # A CNAME cannot exist at a zone apex alongside the zone's own SOA and NS
  # records, so the apex is the one case that must use A records.
  zone_apex = trimsuffix(var.route53_zone_name, ".")
  is_apex   = trimsuffix(var.custom_domain, ".") == local.zone_apex
}

resource "aws_route53_record" "cname" {
  provider = aws
  count    = local.is_apex ? 0 : 1

  zone_id = data.aws_route53_zone.this.zone_id
  name    = var.custom_domain
  type    = "CNAME"
  ttl     = 300

  # Derived from the site this module created, so it cannot point at a site
  # that no longer exists or was renamed.
  records = ["${google_firebase_hosting_site.this.site_id}.web.app"]
}

resource "aws_route53_record" "a" {
  provider = aws
  count    = local.is_apex ? 1 : 0

  zone_id = data.aws_route53_zone.this.zone_id
  name    = var.custom_domain
  type    = "A"
  ttl     = 300
  records = var.hosting_a_records
}

resource "aws_route53_record" "verification" {
  provider = aws
  count    = var.domain_verification_txt == "" ? 0 : 1

  zone_id = data.aws_route53_zone.this.zone_id
  name    = var.custom_domain
  type    = "TXT"
  ttl     = 300
  records = [var.domain_verification_txt]
}
