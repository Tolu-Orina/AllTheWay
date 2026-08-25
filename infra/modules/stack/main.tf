/**
 * One complete environment: Firestore, the five Cloud Run services with their
 * invoker graph, and the Firebase Hosting site.
 *
 * dev and prod are the same shape with different names, so they are the same
 * module. Divergence between environments is the thing this prevents.
 */

locals {
  # Only the gateway faces the internet. The rest are internal-only and are
  # reachable exactly by the identities named here — this is the enforcement
  # point for the architecture doc's zero-trust service-to-service rule.
  invoker_graph = {
    gateway             = []
    orchestrator        = ["gateway"]
    research-cell       = ["orchestrator"]
    profile-synthesizer = ["orchestrator"]
    watcher-runtime     = ["orchestrator"]
    # The Agent Gateway is reachable only by the two things that act: the
    # orchestrator on a user's behalf, and the watcher runtime on a trigger.
    # Nothing else, and never the browser -- the browser has no path to a
    # connector that does not pass through policy enforcement.
    connector-gateway = ["orchestrator", "watcher-runtime"]
  }

  runtime_sa = var.runtime_service_accounts
}

# Prod uses the project's default database; dev gets a named one alongside it.
# One project can hold several Firestore databases, which is what makes a
# single-project two-environment setup viable.
resource "google_firestore_database" "this" {
  project     = var.project_id
  name        = var.env == "prod" ? "(default)" : var.env
  location_id = var.firestore_location
  type        = "FIRESTORE_NATIVE"

  deletion_policy = var.env == "prod" ? "ABANDON" : "DELETE"
}

# The project number is needed to compute Cloud Run's deterministic URLs.
data "google_project" "this" {
  project_id = var.project_id
}

locals {
  # Cloud Run's stable URL form. Using this rather than each service's `uri`
  # output avoids a dependency cycle: a service cannot reference its own URL
  # while it is still being created, and its callers must know it up front.
  service_url = {
    for name, _ in local.invoker_graph :
    name => "https://${name}-${var.env}-${data.google_project.this.number}.${var.region}.run.app"
  }

  # Who needs to reach whom. This mirrors invoker_graph, which grants the IAM
  # permission to make the call -- these are the addresses to make it to. The
  # two are deliberately adjacent: a service that can reach another but does
  # not know where it is, is as broken as one that knows and may not.
  peer_env_vars = {
    gateway = {
      ORCHESTRATOR_URL = local.service_url["orchestrator"]
      # Phase 2: the turn stream cannot go through the Firebase Hosting rewrite
      # (60s timeout), so it is served from this service's own hostname and is
      # therefore cross-origin. See docs/decisions/0001.
      WEB_ORIGINS = var.custom_domain != "" ? "https://${var.custom_domain}" : ""
    }
    orchestrator = {
      RESEARCH_CELL_URL     = local.service_url["research-cell"]
      CONNECTOR_GATEWAY_URL = local.service_url["connector-gateway"]
    }
    watcher-runtime = {
      ORCHESTRATOR_URL      = local.service_url["orchestrator"]
      CONNECTOR_GATEWAY_URL = local.service_url["connector-gateway"]
    }
    profile-synthesizer = {}
    research-cell       = {}
    # Screening is mandatory on untrusted external content, and it fails closed:
    # without a template the connector gateway refuses rather than passing
    # content through unscreened. See libs/screening.
    connector-gateway = {
      MODEL_ARMOR_TEMPLATE = var.model_armor_template
      USE_SECRET_MANAGER   = "true"
    }
  }
}

module "service" {
  source   = "../backend-service"
  for_each = local.invoker_graph

  project_id   = var.project_id
  region       = var.region
  env          = var.env
  service_name = each.key

  runtime_service_account = local.runtime_sa["${each.key}-${var.env}"]
  allow_unauthenticated   = each.key == "gateway"

  invoker_service_accounts = [
    for caller in each.value : local.runtime_sa["${caller}-${var.env}"]
  ]

  min_instances = var.env == "prod" ? var.prod_min_instances : 0
  max_instances = var.env == "prod" ? 20 : 4

  env_vars = merge(var.common_env_vars, {
    APP_ENV              = var.env
    GOOGLE_CLOUD_PROJECT = var.project_id
    FIRESTORE_DATABASE   = google_firestore_database.this.name

    # Its own address, as other agents will see it.
    #
    # This is not cosmetic. An A2A client fetches the callee's AgentCard and
    # then talks to the URL the *card* advertises, not the URL it was given.
    # A card built without PUBLIC_URL advertises http://localhost:8090, so
    # every caller is politely redirected to itself and the call fails with
    # ECONNREFUSED. Found by running the built gateway image against a
    # containerised orchestrator; nothing in a unit test can catch it.
    PUBLIC_URL = local.service_url[each.key]
  }, local.peer_env_vars[each.key])
}

module "hosting" {
  source = "../web-hosting"

  providers = {
    google-beta = google-beta
    aws         = aws
  }

  project_id              = var.project_id
  site_id                 = var.hosting_site_id
  custom_domain           = var.custom_domain
  route53_zone_name       = var.route53_zone_name
  domain_verification_txt = var.domain_verification_txt
}

# ---------------------------------------------------------------------------
# Events
#
# Topics were missing entirely until now: the gateway published to a topic that
# only ever existed because a local script created it. In a real project that
# would have failed silently at runtime — the publisher logs and swallows the
# error so a failed publish never fails a user's request.
# ---------------------------------------------------------------------------

resource "google_pubsub_topic" "events" {
  for_each = toset(["session-ended", "watcher-trigger"])

  project = var.project_id
  name    = "${each.value}-${var.env}"
}

locals {
  # Which service consumes which topic, and at what path.
  event_consumers = {
    "session-ended"   = { service = "profile-synthesizer", path = "/events" }
    "watcher-trigger" = { service = "watcher-runtime", path = "/events" }
  }
}

resource "google_pubsub_subscription" "push" {
  for_each = local.event_consumers

  project = var.project_id
  name    = "${each.key}-${var.env}"
  topic   = google_pubsub_topic.events[each.key].name

  push_config {
    push_endpoint = "${module.service[each.value.service].uri}${each.value.path}"

    # Pub/Sub authenticates to the internal-only service as its own identity,
    # so the endpoint stays closed to everything else.
    oidc_token {
      service_account_email = local.runtime_sa["${each.value.service}-${var.env}"]
    }
  }

  # Give a run time to finish before redelivering; consumers are idempotent, so
  # a duplicate is harmless, but needless retries are still waste.
  ack_deadline_seconds = 60

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }
}
