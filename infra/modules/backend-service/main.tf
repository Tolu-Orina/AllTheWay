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

  ingress = var.allow_unauthenticated ? "INGRESS_TRAFFIC_ALL" : "INGRESS_TRAFFIC_INTERNAL_ONLY"

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
    ]
  }
}

# Only the gateway is reachable from the internet. Everything else is invoked
# service-to-service with an IAM-authenticated identity.
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
