/**
 * Product catalog of sample-deck screenshots.
 *
 * Not user artifacts. Those live under {uid}/{artifactId}/{n} in the
 * artifacts bucket. This bucket is the design graph the planner retrieves:
 * LibreOffice PNGs that gemini-embedding-2 embeds with coordinates.
 *
 * Runtime identities only read. Ingest (ADC / CI) writes.
 */

resource "google_storage_bucket" "slide_designs" {
  project  = var.project_id
  name     = "${var.project_id}-slide-designs-${var.env}"
  location = upper(var.region)

  public_access_prevention    = "enforced"
  uniform_bucket_level_access = true

  labels = {
    env     = var.env
    content = "slide-design-catalog"
  }
}

resource "google_storage_bucket_iam_member" "gateway_slide_designs" {
  bucket = google_storage_bucket.slide_designs.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${local.runtime_sa["gateway-${var.env}"]}"
}

resource "google_storage_bucket_iam_member" "document_cell_slide_designs" {
  bucket = google_storage_bucket.slide_designs.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${local.runtime_sa["document-cell-${var.env}"]}"
}

# Vertex reads gs:// URIs with this identity, not the Cloud Run SA.
resource "google_storage_bucket_iam_member" "vertex_slide_designs" {
  bucket = google_storage_bucket.slide_designs.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:service-${data.google_project.this.number}@gcp-sa-aiplatform.iam.gserviceaccount.com"
}
