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
    gateway = []
    # `scribe` is here because it screens transcripts through the orchestrator
    # before anything reasons about them. Giving it ORCHESTRATOR_URL without
    # this is the exact failure the comment below warns about: a service that
    # knows where another is and may not call it.
    orchestrator  = ["gateway", "registry", "scribe"]
    research-cell = ["orchestrator", "registry"]
    # Leaf cell: compiles IR after Yes. Gateway is the only actor; registry
    # fetches the card. Never faces the internet.
    document-cell       = ["gateway", "registry"]
    profile-synthesizer = ["orchestrator"]
    watcher-runtime     = ["orchestrator"]
    # The Agent Gateway is reachable only by the two things that act: the
    # orchestrator on a user's behalf, and the watcher runtime on a trigger.
    # Nothing else, and never the browser -- the browser has no path to a
    # connector that does not pass through policy enforcement.
    # The gateway joins the two things that act, for reads only.
    #
    # v3.5 §2.1 made the gateway the actor on a confirmed plan. This adds the
    # other half: a voice session that can *look things up* — what is on your
    # calendar today — without a planning round trip. Writes still go through
    # the planner and the confirm gate; nothing here changes that.
    #
    # The connector gateway enforces the autonomy floor itself, so being on this
    # list buys the gateway reachability, not permission to skip confirmation.
    connector-gateway = ["orchestrator", "watcher-runtime", "registry", "gateway"]

    # The Agent Registry reads every agent's card, so it calls all three and is
    # called only by the gateway.
    #
    # Giving the gateway invoker rights here does not weaken the rule above.
    # The registry holds no connector power — it fetches cards and reports what
    # it found — so a path from the browser to the registry is not a path from
    # the browser to a connector.
    registry = ["gateway"]

    # Holds the user's documents. Reachable by the two services that legitimately
    # act on a user's behalf, and by nothing else. It calls nothing itself, which
    # is what keeps a malicious PDF attacking the extraction library from
    # reaching anything that can act.
    librarian = ["gateway", "orchestrator", "registry"]

    # Meetings, whichever tier serves them. Called by the gateway, which is the
    # only thing holding a user session; it calls the orchestrator, which owns
    # screening and planning.
    #
    # It is deliberately NOT reachable by the watcher runtime. A watcher runs
    # unattended, and joining a meeting is the least appropriate thing for an
    # unattended process to decide to do — every participant sees a dialog when
    # the agent connects, so an unwanted join is visible to the whole room and
    # attributable to the user who did not ask for it.
    scribe = ["gateway", "registry"]
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
      CONNECTOR_GATEWAY_URL = local.service_url["connector-gateway"]
      ORCHESTRATOR_URL      = local.service_url["orchestrator"]
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
      REGISTRY_URL      = local.service_url["registry"]
      LIBRARIAN_URL     = local.service_url["librarian"]
      SCRIBE_URL        = local.service_url["scribe"]
      DOCUMENT_CELL_URL = local.service_url["document-cell"]

      WEB_ORIGINS = join(",", compact([
        var.custom_domain != "" ? "https://${var.custom_domain}" : "",
        "https://${var.hosting_site_id}.web.app",
      ]))

      # Lookup key, not a price id: test and live Stripe accounts differ only
      # by secret. Empty STRIPE_PRICE_PLUS is the intended production path.
      STRIPE_LOOKUP_KEY = "plus"
    }
    scribe = {
      # Screening and planning live in the orchestrator. The scribe stores what
      # was said and hands it on: two screeners in two languages would drift,
      # and the drift would be silent until something got through the one that
      # was not updated.
      ORCHESTRATOR_URL = local.service_url["orchestrator"]

      # Where Google should publish conference events. Google needs a topic
      # name, not a subscription: the push subscription on our side already
      # exists, and pointing Workspace Events at it directly would couple an
      # external system to a resource we recreate.
      MEET_EVENTS_TOPIC = google_pubsub_topic.events["meet-events"].id
    }
    orchestrator = {
      RESEARCH_CELL_URL     = local.service_url["research-cell"]
      CONNECTOR_GATEWAY_URL = local.service_url["connector-gateway"]
    }
    watcher-runtime = {
      ORCHESTRATOR_URL      = local.service_url["orchestrator"]
      CONNECTOR_GATEWAY_URL = local.service_url["connector-gateway"]

      # The due-scan publishes onto the existing trigger topic. Full resource
      # id, same shape as MEET_EVENTS_TOPIC: a short name would publish into
      # the wrong project the moment the runtime identity is in another one.
      WATCHER_TRIGGER_TOPIC = google_pubsub_topic.events["watcher-trigger"].id

      # The service that reads what strangers wrote. It screens the trigger
      # inbound and the plan outbound (runtime.py), and until now it did both
      # with the heuristic screener because nothing set this.
      MODEL_ARMOR_TEMPLATE = google_model_armor_template.screening.name
      GEMMA_SCREENING      = "true"
    }
    profile-synthesizer = {}
    research-cell       = {}
    document-cell       = {}

    # Derived here rather than listed in the registry's own code, so the
    # catalogue cannot disagree with what Cloud Run actually serves.
    librarian = {
      MODEL_ARMOR_TEMPLATE = google_model_armor_template.screening.name

      # The second opinion. Gemma is served as a managed API — serverless,
      # per-token — not a self-deployed endpoint, which an earlier
      # investigation wrongly concluded. Measured: the heuristic layer misses a
      # paraphrased injection that Gemma catches, and neither blocks "please
      # ignore my earlier email".
      GEMMA_SCREENING = "true"


      # Deliberately NOT GOOGLE_CLOUD_LOCATION. That is `global`, where text
      # generation runs. Every embedding model is available in europe-west1, so
      # the user's corpus — the most sensitive data v3 introduces — never leaves
      # the region. Collapsing two regions into one variable is what broke voice.
      EMBEDDING_LOCATION = var.region

      # 1536, not the model's 3072 default, because Firestore's vector index
      # caps at 2048. The default fails at write time, on real documents.
      EMBEDDING_DIMENSIONS = "1536"
    }

    registry = {
      ORCHESTRATOR_URL      = local.service_url["orchestrator"]
      RESEARCH_CELL_URL     = local.service_url["research-cell"]
      CONNECTOR_GATEWAY_URL = local.service_url["connector-gateway"]
      LIBRARIAN_URL         = local.service_url["librarian"]
      SCRIBE_URL            = local.service_url["scribe"]
      DOCUMENT_CELL_URL     = local.service_url["document-cell"]
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
      GEMMA_SCREENING      = "true"

      USE_SECRET_MANAGER = "true"
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
# convenient later: the gateway and the watcher runtime publish events, the
# services that call a model hold aiplatform.user, and only the connector
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
    document-cell       = ["roles/aiplatform.user", "roles/datastore.user"] # Vertex + slideDesigns catalog
    profile-synthesizer = ["roles/datastore.user"]
    watcher-runtime = [
      "roles/datastore.user",
      # Due-scan and session-ended fan-out publish onto watcher-trigger.
      "roles/pubsub.publisher",
    ]

    # Meetings, consent, credentials and the meeting registry -- four modules,
    # all through firebase-admin. Scribe had no entry here at all, so its
    # identity carried only the three baseline roles and every Firestore call
    # failed with PERMISSION_DENIED. That surfaced as `/api/meetings` returning
    # 502 while the error crashed the container, which then restarted clean --
    # so the logs showed healthy startups and nothing else.
    #
    # Firestore only: scribe reaches no other Google API. Its transcription runs
    # in the gateway, which is why aiplatform is not here.
    scribe = ["roles/datastore.user"]
    librarian = [
      "roles/datastore.user",  # documents and chunks, under each user's path
      "roles/aiplatform.user", # embeddings, in europe-west1
      "roles/modelarmor.user", # screening, before any model reads a document
    ]
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

      # generate_image / Veo run here, with this identity. Without this the
      # call authenticates and Vertex answers 403, which Studio used to
      # report as an unreadable still rather than a refused model.
      "roles/aiplatform.user",
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

      # Generation runs here, and only this service generates. Set explicitly
      # rather than left to the connector's own default so that the region a
      # revision actually used is readable from the revision itself — the
      # default is invisible at exactly the moment someone is asking where a
      # video was produced.
      MEDIA_LOCATION = var.media_location
    }
    document-cell = {
      MEDIA_LOCATION      = var.media_location
      SLIDE_REFERENCE_DIR = "/repo/services/document-cell/references"
      HOME                = "/tmp"
      SLIDE_DESIGN_BUCKET = google_storage_bucket.slide_designs.name
      SLIDE_EMBEDDING_MODEL    = "gemini-embedding-2"
      SLIDE_EMBEDDING_LOCATION = "global"
    }
    gateway = {
      # Where artifact bytes live. Empty would disable artifacts rather than
      # fail at import, but it is never empty here — the bucket is created
      # alongside the service.
      ARTIFACTS_BUCKET = google_storage_bucket.artifacts.name
      SLIDE_DESIGN_BUCKET      = google_storage_bucket.slide_designs.name
      SLIDE_EMBEDDING_MODEL    = "gemini-embedding-2"
      SLIDE_EMBEDDING_LOCATION = "global"

      MAIL_FROM         = var.mail_from
      GEMINI_LIVE_MODEL = var.gemini_live_model

      # Meeting transcription (Tier 1.5). Its own model and its own location,
      # deliberately not the two above.
      #
      # GOOGLE_CLOUD_LIVE_LOCATION is regional *because the conversation model
      # does not exist at `global`*. This model is the exact reverse: `global`
      # is the only location that serves it. One variable for both would be
      # wrong for one of them by construction.
      MEETING_TRANSCRIBE_MODEL    = var.meeting_transcribe_model
      MEETING_TRANSCRIBE_LOCATION = "global"

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
  # Every service that publishes a card signs it. librarian and scribe joined in
  # v3; document-cell was added later and served a card with no key, so the
  # registry correctly reported it unverified — including the URL it advertises.
  card_signing_services = [
    "orchestrator",
    "research-cell",
    "document-cell",
    "connector-gateway",
    "librarian",
    "scribe",
  ]

  # Built per service rather than by merging two maps.
  #
  # `merge()` is shallow: a service appearing in both maps takes the second
  # entry WHOLE, discarding the first. librarian appears twice — it signs a card
  # and it verifies scope tokens — so a shallow merge silently dropped its
  # signing key and it would have served an unsigned card while looking entirely
  # configured. The registry would have reported it unverified, and the cause
  # would have looked like a key problem rather than a Terraform one.
  card_secret_env = {
    for service in distinct(concat(local.card_signing_services, ["registry", "librarian"])) :
    service => merge(
      contains(local.card_signing_services, service) ? {
        AGENT_CARD_SIGNING_KEY = "agentcard_signing_key"
        AGENT_CARD_PUBLIC_KEY  = "agentcard_public_key"
      } : {},

      # Verifies, never signs. Deliberately given the public key only: a registry
      # that could sign could manufacture a trusted entry for an agent nobody
      # deployed, which is precisely what it exists to detect.
      service == "registry" ? {
        AGENT_CARD_PUBLIC_KEY = "agentcard_public_key"
      } : {},

      # Verifies scope tokens; cannot mint them. The librarian being unable to
      # name its own user is the entire point of layer 4.
      service == "librarian" ? {
        SCOPE_TOKEN_PUBLIC_KEY = "scopetoken_public_key"
      } : {},
    )
  }

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
      # Signs scope tokens. A different keypair from AgentCard signing on
      # purpose: the gateway is excluded from minting cards, and gaining the
      # ability to scope requests must not quietly grant that too.
      {
        SCOPE_TOKEN_SIGNING_KEY = "scopetoken_signing_key"
      },
      var.stripe_secret_key_secret == "" ? {} : {
        STRIPE_SECRET_KEY = var.stripe_secret_key_secret
      },
      var.stripe_webhook_secret == "" ? {} : {
        STRIPE_WEBHOOK_SECRET = var.stripe_webhook_secret
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

  min_instances = var.env == "prod" && contains(var.warm_services, each.key) ? var.prod_min_instances : 0
  max_instances = var.env == "prod" ? 20 : 4

  # Voice sockets pin an instance for their duration (ADR 0006). Cloud Run's
  # request timeout is the socket's lifetime: 300s would hang up a call that
  # is still talking. 3600s is the platform maximum. Other services stay at
  # the default — a turn should not last an hour.
  #
  # The scribe is the second service with that shape. A Tier 2 meeting holds a
  # WebRTC session open for as long as the meeting lasts, so a 300s timeout
  # would drop the agent out of every call after five minutes — and it would
  # look like a flaky connection rather than a configured limit.
  #
  # 3600s is the ceiling, which covers the 60-minute meeting the plan requires
  # to survive. A 90-minute meeting still exceeds it; that is what session
  # resumption in Phase F is for, and it is a reconnect problem rather than a
  # number that can be raised.
  #
  # Document-cell visual QA is planner + stills + LibreOffice + independent
  # judge, budgeted at 420s with images. 300s was killing the request before
  # the later turns.
  timeout_seconds = contains(["gateway", "scribe"], each.key) ? 3600 : each.key == "document-cell" ? 480 : 300

  # Studio video: the gateway joins shots in /tmp; connector-gateway holds a
  # finished Veo payload in memory as JSON. 512Mi OOM'd the connector on a
  # completed 8s poll (2026-08-28), and two overlapping polls killed two
  # instances at once.
  #
  # Document-cell runs LibreOffice per compile. 1Gi OOMs a PPTX→PDF→PNG
  # pass; 2Gi is the floor that matches local visual QA.
  memory = each.key == "document-cell" ? "2Gi" : contains(["gateway", "connector-gateway"], each.key) ? "1Gi" : "512Mi"
  cpu    = each.key == "document-cell" ? "2" : "1"

  # Concurrency, set for the pinned case rather than for today's traffic.
  #
  # Tier 2 is refused for every meeting right now — the preview is not enrolled
  # — so the scribe currently serves short REST calls that would be perfectly
  # happy at the default of 40. The day enrolment arrives, that same 40 becomes
  # forty simultaneous meetings decoding audio on one instance, and nobody will
  # remember to come back and change it.
  #
  # So it is chosen now for the shape this service is built for. Four is small
  # enough that a pinned session has room, and large enough that the REST path
  # does not scale out for no reason.
  #
  # Document-cell is one soffice profile per request and 2Gi. Two overlapping
  # compiles on one instance would fight for RAM; scale out instead.
  concurrency = each.key == "scribe" ? 4 : each.key == "document-cell" ? 1 : 40

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
    google_secret_manager_secret_iam_member.scope_token_signer,
    google_secret_manager_secret_iam_member.scope_token_verifier,
    google_secret_manager_secret_iam_member.gateway_reads_oauth_client,
    google_secret_manager_secret_iam_member.gateway_reads_resend_key,
    google_secret_manager_secret_iam_member.gateway_reads_stripe,
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
  # Topics are the named buses. Consumers are who reads them. They must not
  # be the same map: two services subscribe to session-ended, and adding a
  # consumer key must not invent a topic.
  for_each = local.event_topics

  project = var.project_id
  name    = "${each.value}-${var.env}"
}

locals {
  # Existing topic keys stay so Terraform does not destroy them.
  event_topics = toset([
    "session-ended",
    "watcher-trigger",
    "meet-events",
    "digest-due",
    "watcher-due",
    "reminder-due",
  ])

  # Which service consumes which topic, and at what path.
  event_consumers = {
    "session-ended" = { topic = "session-ended", service = "profile-synthesizer", path = "/events" }
    # Same topic, second subscriber. The runtime matches triggerKind rather
    # than receiving a dedicated bus — the gateway already publishes here.
    "session-ended-watchers" = { topic = "session-ended", service = "watcher-runtime", path = "/events/session-ended" }
    "watcher-trigger"        = { topic = "watcher-trigger", service = "watcher-runtime", path = "/events" }
    # Tier 1's trigger. Google Workspace Events publishes here when a conference
    # ends, which is the moment a transcript can exist — polling for something
    # that happens twice a day would be both wasteful and late.
    "meet-events" = { topic = "meet-events", service = "scribe", path = "/events/meet" }
    # The morning digest. The watcher runtime consumes it because it already
    # owns the per-user push path and the run records the digest reports on —
    # a separate service would need both, and would be a second thing to keep
    # alive for one message a day.
    "digest-due"  = { topic = "digest-due", service = "watcher-runtime", path = "/events/digest" }
    "watcher-due" = { topic = "watcher-due", service = "watcher-runtime", path = "/events/due" }
    # Leave-now. One-minute scan is the shippable backup; Cloud Tasks at fireAt
    # is the preferred path once Tasks IAM is in place. A missed pickup is
    # worse than a missed digest, so this tick is tighter than watcher-due.
    "reminder-due" = { topic = "reminder-due", service = "watcher-runtime", path = "/events/reminders" }
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
  topic   = google_pubsub_topic.events[each.value.topic].name

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


# ---------------------------------------------------------------------------
# The daily digest
#
# One job, one message. The handler fans out to users itself rather than the
# scheduler holding a list of them: a schedule that has to be edited whenever
# somebody signs up is a schedule that will be wrong.
#
# Time zone is explicit. "07:00" with no zone means UTC, which is 08:00 in
# British summer and 07:00 in winter — a digest that arrives at a different
# time depending on the season looks broken rather than scheduled.
# ---------------------------------------------------------------------------

resource "google_cloud_scheduler_job" "digest" {
  project  = var.project_id
  region   = var.region
  name     = "digest-${var.env}"
  schedule = "0 7 * * *"

  # Europe/London rather than UTC: this is a *morning* digest, and morning is a
  # local idea. See var.digest_time_zone for the single-tenant caveat.
  time_zone = var.digest_time_zone

  description = "Publishes the daily digest trigger. The watcher runtime fans it out per user."

  pubsub_target {
    topic_name = google_pubsub_topic.events["digest-due"].id
    # An empty sweep message. A userId here would mean the scheduler knew the
    # user list, which is exactly what it must not need to know.
    data = base64encode(jsonencode({ sweep = true }))
  }

  depends_on = [google_pubsub_topic.events]
}

# ---------------------------------------------------------------------------
# Watcher due-scan
#
# One job, one message every five minutes. The handler fans out to due rows
# itself rather than the scheduler holding a user list or a per-watcher job:
# N scheduler jobs is how a standing instruction becomes a denial-of-wallet.
#
# UTC on purpose. This is a due-scan, not a morning product. Local morning
# belongs on the watcher's interval, not on the tick that notices it.
# ---------------------------------------------------------------------------

resource "google_cloud_scheduler_job" "watcher_due" {
  project   = var.project_id
  region    = var.region
  name      = "watcher-due-${var.env}"
  schedule  = "*/5 * * * *"
  time_zone = "Etc/UTC"

  description = "Publishes the watcher due-scan. The runtime fans it out per due row."

  pubsub_target {
    topic_name = google_pubsub_topic.events["watcher-due"].id
    data       = base64encode(jsonencode({ sweep = true }))
  }

  depends_on = [google_pubsub_topic.events]
}

# Leave-now reminders. Cloud Tasks at fireAt is the preferred path (a one-shot
# at the exact instant); this one-minute scan is the shippable backup until
# that IAM is in place. Five minutes is acceptable for "leave in 15"; not
# for "leave in 90 seconds".
resource "google_cloud_scheduler_job" "reminder_due" {
  project   = var.project_id
  region    = var.region
  name      = "reminder-due-${var.env}"
  schedule  = "* * * * *"
  time_zone = "Etc/UTC"

  description = "Publishes the reminder due-scan. Prefer Cloud Tasks at fireAt when IAM allows."

  pubsub_target {
    topic_name = google_pubsub_topic.events["reminder-due"].id
    data       = base64encode(jsonencode({ sweep = true }))
  }

  depends_on = [google_pubsub_topic.events]
}

# The due-scan filters running==true AND nextRunAt<=now. Two fields, so a
# composite is required; a missing index fails the query at runtime, not at
# apply. Identical to the entry in firestore.indexes.json.
resource "google_firestore_index" "watcher_schedule_due" {
  project    = var.project_id
  database   = google_firestore_database.this.name
  collection = "watcherSchedule"

  fields {
    field_path = "running"
    order      = "ASCENDING"
  }

  fields {
    field_path = "nextRunAt"
    order      = "ASCENDING"
  }
}

# documentChunks.find_nearest(embedding) filtered by ownerUid. Writes succeed
# without this; asking about an uploaded document does not. Identical to the
# vector entry in firestore.indexes.json. query_scope is COLLECTION — retrieval
# is always path-scoped to one user, never a collection group.
resource "google_firestore_index" "document_chunks_nearest" {
  project     = var.project_id
  database    = google_firestore_database.this.name
  collection  = "documentChunks"
  query_scope = "COLLECTION"

  fields {
    field_path = "ownerUid"
    order      = "ASCENDING"
  }

  fields {
    field_path = "__name__"
    order      = "ASCENDING"
  }

  fields {
    field_path = "embedding"
    vector_config {
      dimension = 1536
      flat {}
    }
  }
}

# slideDesigns.find_nearest(embedding). Product catalog of sample-deck
# geometry — not user documents. query_scope is COLLECTION on the root
# collection, never a collection group. gemini-embedding-2 at 1536
# (default 3072 exceeds Firestore's 2048 cap).
resource "google_firestore_index" "slide_designs_nearest" {
  project     = var.project_id
  database    = google_firestore_database.this.name
  collection  = "slideDesigns"
  query_scope = "COLLECTION"

  fields {
    field_path = "__name__"
    order      = "ASCENDING"
  }

  fields {
    field_path = "embedding"
    vector_config {
      dimension = 1536
      flat {}
    }
  }
}
