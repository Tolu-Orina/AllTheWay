/**
 * One Cloud Run service.
 *
 * Defaults follow the Technical Architecture doc: min-instances 0,
 * concurrency 40, CPU not always-allocated — i.e. genuinely scale-to-zero.
 *
 * Terraform owns the service's *shape*; CI owns the image it runs. The
 * lifecycle block below is what keeps those two from fighting: without it,
 * every `terraform apply` would roll the service back to whatever image tag
 * was last committed, silently undoing a deploy.
 */

resource "google_cloud_run_v2_service" "this" {
  project  = var.project_id
  name     = "${var.service_name}-${var.env}"
  location = var.region

  # Reachability is gated by IAM, not by ingress.
  #
  # INTERNAL_ONLY looks stricter and was not: Cloud Run rejects a request the
  # ingress rule disallows with a *404*, and a Cloud Run service calling another
  # Cloud Run service leaves over the public internet unless its egress is routed
  # through a VPC. There is no VPC here, so every gateway -> service call was
  # refused at the edge. In production that surfaced as `/api/registry/agents`
  # answering 502 for thirty days without a single success, and as voice turns
  # failing with "The planner could not finish this turn" — the WebSocket
  # upgraded, then the call to the orchestrator was refused.
  #
  # What actually protects these services is unchanged: `allow_unauthenticated`
  # is false for all of them, so only the principals granted roles/run.invoker —
  # today just run-gateway-${var.env}@ — can call them at all. An anonymous
  # request reaches the edge and is rejected there with a 403.
  ingress = "INGRESS_TRAFFIC_ALL"

  deletion_protection = var.env == "prod"

  template {
    service_account = var.runtime_service_account

    max_instance_request_concurrency = var.concurrency
    timeout                          = "${var.timeout_seconds}s"

    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    containers {
      image = var.image

      resources {
        limits = {
          cpu    = var.cpu
          memory = var.memory
        }
        # false => billed only while handling a request.
        cpu_idle = true
      }

      dynamic "env" {
        for_each = var.env_vars
        content {
          name  = env.key
          value = env.value
        }
      }

      # Secrets arrive as references, never as literal values in state.
      dynamic "env" {
        for_each = var.secret_env_vars
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value
              version = "latest"
            }
          }
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
      client,
      client_version,

      # The service-level `scaling` block, which is not the same thing as
      # `template.scaling` above. The API populates it with defaults whether or
      # not it is declared, so a config that omits it produces a diff that
      # removes it, an API that re-adds it, and a plan that is never clean.
      #
      # Worth fixing rather than tolerating: a permanently dirty plan trains
      # everyone to skim past it, which is how a real change gets missed. What
      # this service actually manages is per-revision scaling, declared above.
      scaling,
    ]
  }
}

# Only the gateway is reachable *anonymously*. Everything else is invoked
# service-to-service with an IAM-authenticated identity.
#
# This binding, not the ingress rule above, is the boundary: every service now
# has INGRESS_TRAFFIC_ALL, so an unauthenticated request to one of them reaches
# the edge and is refused there with a 403 for lacking roles/run.invoker.
resource "google_cloud_run_v2_service_iam_member" "public" {
  count = var.allow_unauthenticated ? 1 : 0

  project  = google_cloud_run_v2_service.this.project
  location = google_cloud_run_v2_service.this.location
  name     = google_cloud_run_v2_service.this.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service_iam_member" "invokers" {
  for_each = toset(var.invoker_service_accounts)

  project  = google_cloud_run_v2_service.this.project
  location = google_cloud_run_v2_service.this.location
  name     = google_cloud_run_v2_service.this.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${each.value}"
}
