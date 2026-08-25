/**
 * One Firebase Hosting site plus the Route 53 records that point at it.
 *
 * Terraform owns the *site*; it does not own the site's *content*. Deploying
 * `dist/` stays a CI step (`firebase deploy --only hosting`). Infrastructure
 * and artifacts are different lifecycles and should not share a pipeline.
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

resource "aws_route53_record" "a" {
  provider = aws

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
