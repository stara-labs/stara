output "github_configuration" {
  description = "Only these publisher endpoints belong in GitHub variables. No config contents, state endpoints, executor identity or credentials."
  value = {
    STARA_IMAGE_WIF_PROVIDER    = google_iam_workload_identity_pool_provider.images.name
    STARA_IMAGE_PUBLISHER       = google_service_account.artifact_publisher.email
    STARA_DISPATCH_WIF_PROVIDER = google_iam_workload_identity_pool_provider.dispatch.name
    STARA_DISPATCH_PUBLISHER    = google_service_account.dispatcher.email
    STARA_STAGING_TOPIC         = google_pubsub_topic.staging.id
    STARA_ARTIFACT_BUCKET       = google_storage_bucket.artifacts.name
    STARA_IMAGE_REPOSITORY      = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.app.repository_id}"
  }
}

output "target_inputs" {
  description = "Private operator wiring for the target root; not a public artifact."
  sensitive   = true
  value = {
    delivery_project_id              = var.project_id
    project_id                       = var.staging_project_id
    artifact_bucket                  = google_storage_bucket.artifacts.name
    staging_executor_service_account = google_service_account.executor.email
    configuration_bucket             = local.target_storage.config
    state_bucket                     = local.target_storage.state
  }
}

output "executor_trigger" {
  sensitive = true
  value = {
    name    = google_cloudbuild_trigger.staging.id
    enabled = var.enable_dispatch
    image   = var.executor_image
  }
}
