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
    orchestrator        = ["gateway", "registry"]
    research-cell       = ["orchestrator", "registry"]
    profile-synthesizer = ["orchestrator"]
    watcher-runtime     = ["orchestrator"]
    # The Agent Gateway is reachable only by the two things that act: the
    # orchestrator on a user's behalf, and the watcher runtime on a trigger.
    # Nothing else, and never the browser -- the browser has no path to a
    # connector that does not pass through policy enforcement.
    connector-gateway = ["orchestrator", "watcher-runtime", "registry"]

    # The Agent Registry reads every agent's card, so it calls all three and is
    # called only by the gateway.
    #
    # Giving the gateway invoker rights here does not weaken the rule above.
    # The registry holds no connector power — it fetches cards and reports what
    # it found — so a path from the browser to the registry is not a path from
    # the browser to a connector.
    registry = ["gateway"]
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
      #
      # Both live hostnames, not just the custom one: the Firebase default
      # domain is serving and is an authorized sign-in domain, so a user can
      # arrive there, sign in successfully, and then have the stream and the
      # voice socket refused by an origin check they never see.
      #
      # Always non-empty, which also matters: the relay treats an empty
      # allow-list as development and accepts any origin, so an unset value
      # would turn a security check off rather than on.
      REGISTRY_URL = local.service_url["registry"]

      WEB_ORIGINS = join(",", compact([
        var.custom_domain != "" ? "https://${var.custom_domain}" : "",
        "https://${var.hosting_site_id}.web.app",
      ]))
    }
    orchestrator = {
      RESEARCH_CELL_URL     = local.service_url["research-cell"]
      CONNECTOR_GATEWAY_URL = local.service_url["connector-gateway"]
    }
    watcher-runtime = {
      ORCHESTRATOR_URL      = local.service_url["orchestrator"]
      CONNECTOR_GATEWAY_URL = local.service_url["connector-gateway"]

      # The service that reads what strangers wrote. It screens the trigger
      # inbound and the plan outbound (runtime.py), and until now it did both
      # with the heuristic screener because nothing set this.
      MODEL_ARMOR_TEMPLATE = google_model_armor_template.screening.name
    }
    profile-synthesizer = {}
    research-cell       = {}

    # Derived here rather than listed in the registry's own code, so the
    # catalogue cannot disagree with what Cloud Run actually serves.
    registry = {
      ORCHESTRATOR_URL      = local.service_url["orchestrator"]
      RESEARCH_CELL_URL     = local.service_url["research-cell"]
      CONNECTOR_GATEWAY_URL = local.service_url["connector-gateway"]
    }
    # Screening is mandatory on untrusted external content, and it fails closed:
    # without a template these services refuse rather than passing content
    # through unscreened. See libs/screening.
    #
    # Taken from the resource, not a variable. A variable defaulting to "" is
    # how the watcher runtime came to run in production with no template at
    # all — silently falling back to the heuristic screener, which is a floor
    # and says so, on the exact content the manifest calls out as needing the
    # real thing.
    connector-gateway = {
      MODEL_ARMOR_TEMPLATE = google_model_armor_template.screening.name
      USE_SECRET_MANAGER   = "true"
    }
  }
}

# ---------------------------------------------------------------------------
# What each runtime identity may do
#
# Bootstrap gives every runtime account the same baseline (pull an image, write
# logs and traces) and says the rest "belongs in envs/*". This is that.
#
# Derived from what each service's code actually calls, not from what might be
# convenient later: the gateway is the only thing that publishes events, only
# the two services with a ModelProvider reach Vertex, and only the connector
# gateway reads secrets. A service that gains a dependency gains a line here, in
# a diff someone reads.
# ---------------------------------------------------------------------------

locals {
  service_roles = {
    gateway = [
      "roles/datastore.user",   # Firestore via firebase-admin
      "roles/pubsub.publisher", # events.ts

      # Admin Auth: routes/auth.ts calls getUser, getUserByEmail and
      # updateUser to read an address off a uid, mark an address verified, and
      # set a new password after a reset code checks out.
      #
      # Admin rather than viewer because two of those three write. There is no
      # narrower role that permits updateUser.
      #
      # Note this is NOT what verifyIdToken needs — that validates a signature
      # against Google's public keys and requires no permission at all, which
      # is exactly why the gap stayed hidden: every authenticated route worked,
      # and only the four calls into the Identity Toolkit admin API failed.
      "roles/firebaseauth.admin",
      # Voice relay: the gateway holds the Vertex Live session. Without this
      # the browser socket would open and then the upstream handshake would
      # 401, which looks like a voice bug. See docs/decisions/0006.
      "roles/aiplatform.user",
    ]
    orchestrator        = ["roles/aiplatform.user"] # Vertex, via ModelProvider
    research-cell       = ["roles/aiplatform.user"]
    profile-synthesizer = ["roles/datastore.user"]
    watcher-runtime     = ["roles/datastore.user"]
    connector-gateway = [
      # Project-scoped for now because no connector secret exists yet. Once one
      # does, this should become a per-secret binding — a gateway that can read
      # every secret in the project is more than it needs.
      "roles/secretmanager.secretAccessor",

      # Reads connectorGrants: one document per (user, connector) holding the
      # refresh token for a connected account. It reads only — the grant is
      # written by the gateway's consent callback, which is the only service
      # the browser talks to.
      "roles/datastore.user",
    ]

    # Firestore is deliberately absent from orchestrator and research-cell: both
    # are stateless by design, and granting them data access would quietly make
    # that untrue.
  }

  # Per-service configuration that is not shared and not secret.
  #
  # MAIL_FROM belongs to the gateway alone: it is the only service that sends
  # anything. Put in the common merge it would appear on all six, which reads
  # as "any of these might send mail" to whoever looks at a revision next.
  extra_env_vars = {
    connector-gateway = {
      # Secret *names*, not values. The connector gateway exchanges a user's
      # refresh token for a short-lived access token at the moment of use, and
      # needs the OAuth client to do it. Empty means no connector that reaches
      # a real account can run, which is the correct closed default.
      GOOGLE_OAUTH_CLIENT_ID_SECRET     = var.google_oauth_secrets == null ? "" : var.google_oauth_secrets.client_id
      GOOGLE_OAUTH_CLIENT_SECRET_SECRET = var.google_oauth_secrets == null ? "" : var.google_oauth_secrets.client_secret
    }
    gateway = {
      MAIL_FROM         = var.mail_from
      GEMINI_LIVE_MODEL = var.gemini_live_model

      # Where the Live session opens, and deliberately NOT
      # GOOGLE_CLOUD_LOCATION. That is `global`, which has no Live model at
      # all: the setup message comes back "Publisher model ... was not found"
      # and voice fails every time, while the unit tests pass because they only
      # check URL shape. Verified against this project — europe-west1,
      # europe-west4 and us-central1 all answer setupComplete.
      #
      # var.region also keeps voice audio in the region the services run in.
      GOOGLE_CLOUD_LIVE_LOCATION = var.region
    }
  }

  # Which secrets each service gets, by name. Empty for everything else: a
  # service with no entry is mounted no secrets, which is the default that
  # should require an edit to change.
  #
  # Conditional because an unconfigured mailer is a supported state — the
  # gateway boots and serves every non-email route, and the email routes throw
  # a clear error instead of logging codes to stdout.
  #: Every service that serves or verifies an AgentCard.
  #:
  #: The private key signs; the public key verifies. Both are mounted rather
  #: than passed, so neither reaches Terraform state — and a rotation is a new
  #: secret version rather than a deploy.
  card_signing_services = ["orchestrator", "research-cell", "connector-gateway"]

  card_secret_env = merge(
    {
      for service in local.card_signing_services : service => {
        AGENT_CARD_SIGNING_KEY = "agentcard_signing_key"
        AGENT_CARD_PUBLIC_KEY  = "agentcard_public_key"
      }
    },
    {
      # Verifies, never signs. Deliberately given the public key only: a
      # registry that could sign could manufacture a trusted entry for an agent
      # nobody deployed, which is precisely what it exists to detect.
      registry = {
        AGENT_CARD_PUBLIC_KEY = "agentcard_public_key"
      }
    },
  )

  secret_env_vars = merge(local.card_secret_env, {
    gateway = merge(
      var.resend_api_key_secret == "" ? {} : {
        RESEND_API_KEY = var.resend_api_key_secret
      },
      # The OAuth client the browser consent flow uses. Mounted rather than
      # passed, so the value never reaches Terraform state or the revision
      # spec — and a rotation is a new secret version, not a deploy.
      var.google_oauth_secrets == null ? {} : {
        GOOGLE_OAUTH_CLIENT_ID     = var.google_oauth_secrets.client_id
        GOOGLE_OAUTH_CLIENT_SECRET = var.google_oauth_secrets.client_secret
      },
    )
  })

  runtime_role_bindings = merge([
    for service, roles in local.service_roles : {
      for role in roles : "${service}:${role}" => {
        service = service
        role    = role
      }
    }
  ]...)
}

resource "google_project_iam_member" "runtime" {
  for_each = local.runtime_role_bindings

  project = var.project_id
  role    = each.value.role
  member  = "serviceAccount:${local.runtime_sa["${each.value.service}-${var.env}"]}"
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

  # Voice sockets pin an instance for their duration (ADR 0006). Cloud Run's
  # request timeout is the socket's lifetime: 300s would hang up a call that
  # is still talking. 3600s is the platform maximum. Other services stay at
  # the default — a turn should not last an hour.
  timeout_seconds = each.key == "gateway" ? 3600 : 300

  env_vars = merge(var.common_env_vars, {
    APP_ENV              = var.env
    GOOGLE_CLOUD_PROJECT = var.project_id
    FIRESTORE_DATABASE   = google_firestore_database.this.name

    # Phase 0 item 3. Without this every service runs FakeProvider — it would
    # deploy, pass health checks, and answer with deterministic stub text, which
    # is the most convincing way to look finished while being a mock.
    #
    # The orchestrator, research-cell, and the gateway (voice relay) reach
    # Vertex. Permission is what actually scopes it — the flag on the others
    # is harmless.
    USE_VERTEX = "true"

    # Pinned, never "latest": a silent model swap changes agent behaviour, and
    # this exact string was verified against the live API before pinning —
    # gemini-2.0-flash 404s on the `global` endpoint.
    GEMINI_MODEL = var.gemini_model

    # Its own address, as other agents will see it.
    #
    # This is not cosmetic. An A2A client fetches the callee's AgentCard and
    # then talks to the URL the *card* advertises, not the URL it was given.
    # A card built without PUBLIC_URL advertises http://localhost:8090, so
    # every caller is politely redirected to itself and the call fails with
    # ECONNREFUSED. Found by running the built gateway image against a
    # containerised orchestrator; nothing in a unit test can catch it.
    PUBLIC_URL = local.service_url[each.key]

    # Which key signed this card. Not a secret — it is a name, and it is what
    # lets a rotation publish the new key before the old one is retired
    # without redeploying every verifier.
    AGENT_CARD_KEY_ID = "alltheway-${var.env}"

  }, local.peer_env_vars[each.key], try(local.extra_env_vars[each.key], {}))

  # Mounted, not passed. A secret env var is resolved by Cloud Run at container
  # start from Secret Manager, so the value never appears in the service's
  # Terraform config, its revision spec, or `gcloud run services describe`.
  #
  # Rotating the key is then a new secret *version* and a new revision, with no
  # Terraform change at all — `version = "latest"` in the backend-service
  # module is what makes that true.
  secret_env_vars = try(local.secret_env_vars[each.key], {})

  # Cloud Run resolves a mounted secret at revision creation, so the binding
  # must already exist. Terraform cannot infer that from a secret *name* passed
  # as a string — the first apply of a new environment fails with "Permission
  # denied on secret", having created the grant moments later in the same run.
  depends_on = [
    google_secret_manager_secret_iam_member.card_keys,
    google_secret_manager_secret_iam_member.gateway_reads_oauth_client,
    google_secret_manager_secret_iam_member.gateway_reads_resend_key,
  ]
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
# Verification codes expire themselves
#
# Deliberately on `expiresAt`, not `createdAt`. Firestore deletes a document at
# the time held in its TTL field, so a TTL pointing at the creation time — a
# value already in the past — deletes every code the instant it is written. The
# plan doc said `createdAt`; that would have shipped as "email verification is
# broken" with no obvious cause.
#
# This is garbage collection, not the security control: `verifyCode` enforces
# the ten-minute window itself, because TTL deletion is best-effort and can lag
# by hours. Without it, expired credential hashes accumulate forever.
# ---------------------------------------------------------------------------

# Consent states expire themselves.
#
# Each holds a uid against a random value, and is what authenticates Google's
# callback. The route deletes it on use; this is what removes the ones nobody
# ever came back for, so abandoned consent attempts do not accumulate as a
# growing list of (state -> user) pairs.
resource "google_firestore_field" "connector_states_ttl" {
  project    = var.project_id
  database   = google_firestore_database.this.name
  collection = "connectorStates"
  field      = "expiresAt"

  ttl_config {}
  index_config {}
}

resource "google_firestore_field" "auth_codes_ttl" {
  project    = var.project_id
  database   = google_firestore_database.this.name
  collection = "authCodes"
  field      = "expiresAt"

  ttl_config {}

  # The same field is exempted from indexing in firestore.indexes.json: nothing
  # queries by it, so an automatic index would be pure write cost.
  index_config {}
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

# Pub/Sub push authenticates as the *consumer's* identity, which needs two
# grants that are easy to miss because their absence fails at delivery time —
# quietly, in a retry loop, long after a green apply.
#
#   1. Pub/Sub's own service agent must be allowed to mint a token as that
#      identity. Without it the subscription cannot even produce a credential.
#   2. That identity must be able to invoke the service. `invoker_graph` grants
#      the orchestrator, but the caller here is the consumer itself.
resource "google_service_account_iam_member" "pubsub_mints_consumer_token" {
  for_each = local.event_consumers

  service_account_id = "projects/${var.project_id}/serviceAccounts/${local.runtime_sa["${each.value.service}-${var.env}"]}"
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:service-${data.google_project.this.number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}

resource "google_cloud_run_v2_service_iam_member" "push_invoker" {
  for_each = local.event_consumers

  project  = var.project_id
  location = var.region
  name     = "${each.value.service}-${var.env}"
  role     = "roles/run.invoker"
  member   = "serviceAccount:${local.runtime_sa["${each.value.service}-${var.env}"]}"

  depends_on = [module.service]
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

  # The subscription must not exist before the grants that make it
  # deliverable, or the first messages retry against a 403.
  depends_on = [
    google_service_account_iam_member.pubsub_mints_consumer_token,
    google_cloud_run_v2_service_iam_member.push_invoker,
  ]
}
