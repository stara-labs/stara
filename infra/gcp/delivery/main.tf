locals {
  target_storage = {
    config = "${var.staging_project_id}-release-config"
    state  = "${var.staging_project_id}-release-state"
  }
}

resource "google_project_service" "api" {
  for_each = toset([
    "artifactregistry.googleapis.com", "cloudbuild.googleapis.com",
    "iam.googleapis.com", "iamcredentials.googleapis.com", "logging.googleapis.com",
    "monitoring.googleapis.com", "pubsub.googleapis.com", "storage.googleapis.com",
    "sts.googleapis.com", "serviceusage.googleapis.com",
  ])
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_project_service_identity" "cloud_build" {
  provider   = google-beta
  project    = var.project_id
  service    = "cloudbuild.googleapis.com"
  depends_on = [google_project_service.api]
}

resource "google_project_iam_member" "cloud_build_agent" {
  project = var.project_id
  role    = "roles/cloudbuild.serviceAgent"
  member  = google_project_service_identity.cloud_build.member
}

resource "google_artifact_registry_repository" "app" {
  project       = var.project_id
  location      = var.region
  repository_id = "app"
  format        = "DOCKER"
  docker_config {
    immutable_tags = true
  }
  depends_on = [google_project_service.api]
}

resource "google_artifact_registry_repository" "control" {
  project       = var.project_id
  location      = var.region
  repository_id = "control"
  format        = "DOCKER"
  docker_config {
    immutable_tags = true
  }
  depends_on = [google_project_service.api]
}

resource "google_storage_bucket" "artifacts" {
  project                     = var.project_id
  name                        = "${var.project_id}-release-artifacts"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  versioning {
    enabled = true
  }
  lifecycle {
    prevent_destroy = true
  }
  depends_on = [google_project_service.api]
}

resource "google_service_account" "artifact_publisher" {
  project      = var.project_id
  account_id   = "stara-artifact-publisher"
  display_name = "Verified application artifact publisher"
  depends_on   = [google_project_service.api]
}

resource "google_service_account" "dispatcher" {
  project      = var.project_id
  account_id   = "stara-dispatcher"
  display_name = "Staging candidate signal publisher"
  depends_on   = [google_project_service.api]
}

resource "google_service_account" "executor" {
  project      = var.project_id
  account_id   = "stara-executor"
  display_name = "Private staging release executor"
  depends_on   = [google_project_service.api]
}

resource "google_iam_workload_identity_pool" "publisher" {
  for_each                  = toset(["images", "dispatch"])
  project                   = var.project_id
  workload_identity_pool_id = "stara-${each.key}"
  display_name              = "Stara ${each.key} only"
  depends_on                = [google_project_service.api]
}

resource "google_iam_workload_identity_pool_provider" "images" {
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.publisher["images"].workload_identity_pool_id
  workload_identity_pool_provider_id = "github-images"
  attribute_condition                = "assertion.repository_owner_id == '293455507' && assertion.repository_id == '1363262992' && assertion.ref == 'refs/heads/main' && assertion.workflow_ref == 'stara-labs/stara/.github/workflows/release.yml@refs/heads/main' && assertion.event_name == 'push'"
  attribute_mapping = {
    "google.subject"          = "assertion.sub"
    "attribute.repository_id" = "assertion.repository_id"
    "attribute.publisher"     = "'images'"
  }
  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_iam_workload_identity_pool_provider" "dispatch" {
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.publisher["dispatch"].workload_identity_pool_id
  workload_identity_pool_provider_id = "github-dispatch"
  attribute_condition                = "assertion.repository_owner_id == '293455507' && assertion.repository_id == '1363262992' && assertion.ref == 'refs/heads/main' && assertion.workflow_ref == 'stara-labs/stara/.github/workflows/dispatch.yml@refs/heads/main' && assertion.event_name == 'workflow_run'"
  attribute_mapping = {
    "google.subject"          = "assertion.sub"
    "attribute.repository_id" = "assertion.repository_id"
    "attribute.publisher"     = "'dispatch'"
  }
  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account_iam_member" "image_federation" {
  service_account_id = google_service_account.artifact_publisher.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.publisher["images"].name}/attribute.publisher/images"
}

resource "google_service_account_iam_member" "dispatch_federation" {
  service_account_id = google_service_account.dispatcher.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.publisher["dispatch"].name}/attribute.publisher/dispatch"
}

resource "google_artifact_registry_repository_iam_member" "publish_images" {
  project    = var.project_id
  location   = var.region
  repository = google_artifact_registry_repository.app.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.artifact_publisher.email}"
}

resource "google_storage_bucket_iam_member" "publish_artifacts" {
  bucket = google_storage_bucket.artifacts.name
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:${google_service_account.artifact_publisher.email}"
}

resource "google_pubsub_topic" "staging" {
  project                    = var.project_id
  name                       = "stara-staging-candidates"
  message_retention_duration = "86400s"
  message_storage_policy {
    allowed_persistence_regions = ["us-central1"]
  }
  depends_on = [google_project_service.api]
}

resource "google_pubsub_topic_iam_member" "dispatch" {
  project = var.project_id
  topic   = google_pubsub_topic.staging.name
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:${google_service_account.dispatcher.email}"
}

resource "google_artifact_registry_repository_iam_member" "executor_app_reader" {
  project    = var.project_id
  location   = var.region
  repository = google_artifact_registry_repository.app.name
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${google_service_account.executor.email}"
}

resource "google_artifact_registry_repository_iam_member" "executor_control_reader" {
  project    = var.project_id
  location   = var.region
  repository = google_artifact_registry_repository.control.name
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${google_service_account.executor.email}"
}

resource "google_storage_bucket_iam_member" "executor_artifact_reader" {
  bucket = google_storage_bucket.artifacts.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.executor.email}"
}

resource "google_project_iam_member" "executor_logs" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.executor.email}"
}

resource "google_project_iam_custom_role" "executor_sign_jwt" {
  project     = var.project_id
  role_id     = "staraExecutorSignJwt"
  title       = "Stara executor self JWT signing"
  permissions = ["iam.serviceAccounts.signJwt"]
}

resource "google_service_account_iam_member" "executor_sign_jwt" {
  service_account_id = google_service_account.executor.name
  role               = google_project_iam_custom_role.executor_sign_jwt.name
  member             = "serviceAccount:${google_service_account.executor.email}"
}

resource "google_logging_project_bucket_config" "logs" {
  project        = var.project_id
  location       = "global"
  bucket_id      = "_Default"
  retention_days = 30
  depends_on     = [google_project_service.api]
}

resource "google_monitoring_notification_channel" "operator" {
  project      = var.project_id
  display_name = "Stara private release operator"
  type         = "email"
  enabled      = true
  labels = {
    email_address = var.operator_email
  }
  depends_on = [google_project_service.api]
}

resource "google_monitoring_alert_policy" "release_terminal" {
  project               = var.project_id
  display_name          = "Stara release requires reviewed forward repair"
  combiner              = "OR"
  enabled               = true
  notification_channels = [google_monitoring_notification_channel.operator.name]
  conditions {
    display_name = "Private release terminal failure"
    condition_matched_log {
      filter = "logName=\"projects/${var.project_id}/logs/stara-release\" AND jsonPayload.event=\"release_terminal\" AND jsonPayload.status!=\"succeeded\" AND (jsonPayload.status=\"failed\" OR jsonPayload.status=\"degraded\" OR jsonPayload.status=\"reconciliation_required\")"
    }
  }
  alert_strategy {
    notification_rate_limit {
      period = "300s"
    }
    auto_close = "604800s"
  }
  documentation {
    mime_type = "text/markdown"
    content   = "Private corrective incident. Inspect the receipt and actual Cloud Run operations in private logs. Preserve uncertain locks and traffic. Link a reviewed repair PR, then require a freshly verified main candidate and verified forward recovery before operator closure. Never retry an unknown mutation, clear a lock on expiry, or roll back automatically. Seven-day Monitoring inactivity closure is administrative only; it does not establish recovery or clear durable state. See infra/gcp/README.md."
  }
}

resource "google_monitoring_alert_policy" "executor_crash" {
  project               = var.project_id
  display_name          = "Stara private executor build failure or timeout"
  combiner              = "OR"
  enabled               = true
  notification_channels = [google_monitoring_notification_channel.operator.name]
  conditions {
    display_name = "Cloud Build failure independent of executor notification"
    condition_matched_log {
      filter = "(resource.type=\"build\" AND logName=\"projects/${var.project_id}/logs/cloudbuild\" AND (severity>=ERROR OR textPayload=~\"(?i)(^ERROR|^TIMEOUT|build step .* failed|deadline exceeded|build timed out|build cancelled|internal error)\")) OR (protoPayload.serviceName=\"cloudbuild.googleapis.com\" AND protoPayload.status.code>0)"
    }
  }
  alert_strategy {
    notification_rate_limit {
      period = "300s"
    }
    auto_close = "604800s"
  }
  documentation {
    mime_type = "text/markdown"
    content   = "Private corrective incident for executor failure, including failure before release_terminal is written. Inspect the build and target receipt before further mutations. Unknown operations retain the reconciliation barrier. Link reviewed repair work and verify forward recovery before closure; inactivity auto-close never authorizes retry or establishes recovery. Test the timeout/crash alert path before enabling dispatch."
  }
}

resource "google_cloudbuild_trigger" "staging" {
  project         = var.project_id
  location        = var.region
  name            = "stara-staging-executor"
  description     = "Fixed reviewed staging executor; messages contain candidate data only."
  service_account = google_service_account.executor.name
  disabled        = !var.enable_dispatch
  pubsub_config {
    topic = google_pubsub_topic.staging.id
  }
  substitutions = {
    _PAYLOAD = "$(body.message.data.payload)"
  }
  build {
    timeout   = "1800s"
    queue_ttl = "300s"
    step {
      name       = var.executor_image
      entrypoint = "node"
      dir        = "/app"
      args       = ["tooling/release/cli.mjs", "execute"]
      env = [
        "STARA_CONFIGURATION_URI=gs://${local.target_storage.config}/targets/staging.json",
        "STARA_DISPATCH_PAYLOAD=$_PAYLOAD",
      ]
    }
    options {
      logging               = "CLOUD_LOGGING_ONLY"
      dynamic_substitutions = true
      substitution_option   = "ALLOW_LOOSE"
    }
    tags = ["stara", "staging", "private-executor"]
  }
  depends_on = [
    google_project_iam_member.cloud_build_agent,
    google_project_iam_member.executor_logs,
    google_artifact_registry_repository_iam_member.executor_control_reader,
    google_artifact_registry_repository_iam_member.executor_app_reader,
    google_storage_bucket_iam_member.executor_artifact_reader,
    google_service_account_iam_member.executor_sign_jwt,
    google_logging_project_bucket_config.logs,
    google_monitoring_alert_policy.release_terminal,
    google_monitoring_alert_policy.executor_crash,
  ]
}
