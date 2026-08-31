/**
 * Artifact bytes (v3 Phase A).
 *
 * Firestore holds the index — owner, versions, provenance. This holds the
 * bytes. Two things with different lifecycles and different access patterns,
 * kept apart for the same reason subscriptions and usage counters are.
 *
 * ## Versioning is on, and it is not the artifact's version history
 *
 * The application's version history is explicit rows in Firestore, because it
 * carries meaning — who corrected what, and why. Object versioning here is the
 * separate, duller thing: protection against a delete that should not have
 * happened. One is a product feature; the other is a safety net.
 */

resource "google_storage_bucket" "artifacts" {
  project  = var.project_id
  name     = "${var.project_id}-artifacts-${var.env}"
  location = upper(var.region)

  # Public access is not merely unset — it is prevented. These are the user's
  # contracts and wireframes, and the org policy exemption that lets the
  # gateway be public applies to a Cloud Run service, never to a bucket.
  public_access_prevention    = "enforced"
  uniform_bucket_level_access = true

  versioning {
    enabled = true
  }

  # An orphaned object is the deliberate safe failure of the create path
  # (bytes are written before the index row). This sweeps them.
  #
  # 7 days rather than 1: long enough that an incident can be investigated with
  # the evidence still present, short enough that garbage does not accumulate.
  lifecycle_rule {
    condition {
      age                = 7
      with_state         = "ARCHIVED"
      num_newer_versions = 3
    }
    action {
      type = "Delete"
    }
  }

  # A deleted artifact's bytes are removed by the application. This is the
  # backstop for a delete that failed halfway.
  lifecycle_rule {
    condition {
      days_since_noncurrent_time = 30
    }
    action {
      type = "Delete"
    }
  }

  labels = {
    env     = var.env
    content = "user-artifacts"
  }
}

# The gateway, and only the gateway.
#
# objectAdmin rather than admin: it reads, writes and deletes objects, and has
# no business changing the bucket's own configuration — which is where public
# access prevention and the lifecycle rules live.
resource "google_storage_bucket_iam_member" "gateway_artifacts" {
  bucket = google_storage_bucket.artifacts.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${local.runtime_sa["gateway-${var.env}"]}"
}

# Vertex on the orchestrator reads attached PDFs via gs:// fileData. The
# orchestrator still has no Firestore. Paths are {uid}/{artifactId}/{n};
# only URIs the gateway just wrote are sent on that turn.
resource "google_storage_bucket_iam_member" "orchestrator_artifacts_read" {
  bucket = google_storage_bucket.artifacts.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${local.runtime_sa["orchestrator-${var.env}"]}"
}
