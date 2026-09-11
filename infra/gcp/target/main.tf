locals {
  components = toset(["web", "api"])
  backends   = var.enable_load_balancer ? local.components : toset([])
  executor   = var.environment == "staging" ? var.staging_executor_service_account : google_service_account.isolation_executor[0].email
  iap_grants = {
    for pair in setproduct(local.backends, var.iap_users) : "${pair[0]}/${pair[1]}" => {
      component = pair[0]
      member    = pair[1]
    }
  }
  configuration = {
    schemaVersion = 1
    targetId      = var.environment
    environment   = var.environment
    projectId     = var.project_id
    region        = var.region
    services      = { for component, service in google_cloud_run_v2_service.app : component => service.name }
    runtimeServiceAccounts = {
      for component, account in google_service_account.runtime : component => account.email
    }
    imageRepositories = {
      for component in local.components : component => "${var.region}-docker.pkg.dev/${var.delivery_project_id}/app/${component}"
    }
    executorServiceAccount = local.executor
    loggingProjectId       = var.delivery_project_id
    artifactBucket         = var.artifact_bucket
    stateBucket            = google_storage_bucket.state.name
    stagingOrigin          = "https://${var.hostname}"
    policy = {
      repositoryId = "1363262992"
      workflows = {
        scaffold = {
          workflowRef = "stara-labs/stara/.github/workflows/checks.yml@refs/heads/main"
          jobs        = ["Candidate verification", "Windows package verification", "Container journeys", "Required scaffold checks"]
        }
        images = {
          workflowRef = "stara-labs/stara/.github/workflows/release.yml@refs/heads/main"
          jobs        = ["Verify release images", "Publish verified images"]
        }
        codeql = {
          workflowRef = "dynamic/github-code-scanning/codeql"
          jobs        = ["Analyze (javascript-typescript)", "Analyze (actions)"]
        }
      }
      provenanceWorkflowRef = "stara-labs/stara/.github/workflows/release.yml@refs/heads/main"
      requiredTargets       = ["@stara/web", "@stara/ui", "@stara/api", "@stara/tooling"]
    }
  }
  configuration_json = jsonencode(local.configuration)
}

resource "google_project_service" "api" {
  for_each = toset([
    "artifactregistry.googleapis.com", "certificatemanager.googleapis.com",
    "compute.googleapis.com", "iam.googleapis.com", "iamcredentials.googleapis.com",
    "iap.googleapis.com", "logging.googleapis.com", "monitoring.googleapis.com",
    "run.googleapis.com", "serviceusage.googleapis.com", "storage.googleapis.com",
  ])
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_project_service_identity" "run" {
  provider   = google-beta
  project    = var.project_id
  service    = "run.googleapis.com"
  depends_on = [google_project_service.api]
}

resource "google_project_service_identity" "iap" {
  provider   = google-beta
  project    = var.project_id
  service    = "iap.googleapis.com"
  depends_on = [google_project_service.api]
}

resource "google_project_iam_member" "run_agent" {
  project = var.project_id
  role    = "roles/run.serviceAgent"
  member  = google_project_service_identity.run.member
}

resource "google_project_iam_member" "iap_agent" {
  project = var.project_id
  role    = "roles/iap.serviceAgent"
  member  = google_project_service_identity.iap.member
}

resource "google_service_account" "runtime" {
  for_each     = local.components
  project      = var.project_id
  account_id   = "stara-${each.key}"
  display_name = "Stara ${var.environment} ${each.key} runtime"
  depends_on   = [google_project_service.api]
}

resource "google_service_account" "isolation_executor" {
  count        = var.environment == "isolation" ? 1 : 0
  project      = var.project_id
  account_id   = "stara-isolation-executor"
  display_name = "Isolated negative-permission test executor"
  depends_on   = [google_project_service.api]
}

resource "google_storage_bucket" "config" {
  project                     = var.project_id
  name                        = "${var.project_id}-release-config"
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

resource "google_storage_bucket" "state" {
  project                     = var.project_id
  name                        = "${var.project_id}-release-state"
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

resource "google_storage_bucket_object" "configuration" {
  name          = "targets/${var.environment}.json"
  bucket        = google_storage_bucket.config.name
  content       = local.configuration_json
  content_type  = "application/json"
  cache_control = "no-store"
}

resource "google_storage_bucket_iam_member" "executor_config" {
  bucket = google_storage_bucket.config.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${local.executor}"
}

resource "google_storage_bucket_iam_member" "executor_state" {
  bucket = google_storage_bucket.state.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${local.executor}"
}

resource "google_storage_bucket_iam_member" "isolation_artifacts" {
  count  = var.environment == "isolation" ? 1 : 0
  bucket = var.artifact_bucket
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.isolation_executor[0].email}"
}

resource "google_artifact_registry_repository_iam_member" "run_image_reader" {
  project    = var.delivery_project_id
  location   = var.region
  repository = "app"
  role       = "roles/artifactregistry.reader"
  member     = google_project_service_identity.run.member
}

resource "google_artifact_registry_repository_iam_member" "isolation_image_reader" {
  count      = var.environment == "isolation" ? 1 : 0
  project    = var.delivery_project_id
  location   = var.region
  repository = "app"
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${google_service_account.isolation_executor[0].email}"
}

resource "google_cloud_run_v2_service" "app" {
  for_each             = local.components
  project              = var.project_id
  name                 = "stara-${each.key}"
  location             = var.region
  ingress              = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
  invoker_iam_disabled = false
  default_uri_disabled = true
  deletion_protection  = var.environment == "staging"
  scaling {
    min_instance_count = 0
    max_instance_count = 2
  }
  template {
    service_account                  = google_service_account.runtime[each.key].email
    execution_environment            = "EXECUTION_ENVIRONMENT_GEN2"
    timeout                          = "300s"
    max_instance_request_concurrency = 20
    scaling {
      min_instance_count = 0
      max_instance_count = 2
    }
    containers {
      name  = each.key
      image = var.initial_images[each.key]
      ports {
        container_port = 8080
      }
      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        cpu_idle          = true
        startup_cpu_boost = false
      }
      env {
        name  = "STARA_ENVIRONMENT"
        value = "staging"
      }
      env {
        name  = "HOST"
        value = "0.0.0.0"
      }
      startup_probe {
        initial_delay_seconds = 0
        timeout_seconds       = 2
        period_seconds        = 3
        failure_threshold     = 20
        tcp_socket {
          port = 8080
        }
      }
    }
  }
  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }
  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
      template[0].revision,
      traffic,
      client,
      client_version,
    ]
  }
  depends_on = [
    google_project_iam_member.run_agent,
    google_artifact_registry_repository_iam_member.run_image_reader,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "iap_invoker" {
  for_each   = local.components
  project    = var.project_id
  location   = var.region
  name       = google_cloud_run_v2_service.app[each.key].name
  role       = "roles/run.invoker"
  member     = google_project_service_identity.iap.member
  depends_on = [google_project_iam_member.iap_agent]
}

resource "google_project_iam_custom_role" "executor_service_update" {
  project     = var.project_id
  role_id     = "staraReleaseServiceUpdate"
  title       = "Stara existing service rollout"
  permissions = ["run.services.get", "run.services.update", "run.revisions.get", "run.revisions.list"]
}

resource "google_cloud_run_v2_service_iam_binding" "executor_service_update" {
  for_each = local.components
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.app[each.key].name
  role     = google_project_iam_custom_role.executor_service_update.name
  members  = ["serviceAccount:${local.executor}"]
}

resource "google_project_iam_custom_role" "executor_operation_read" {
  project     = var.project_id
  role_id     = "staraReleaseOperationRead"
  title       = "Stara target operation reconciliation reads"
  permissions = ["run.operations.get"]
}

resource "google_project_iam_member" "executor_operation_read" {
  project = var.project_id
  role    = google_project_iam_custom_role.executor_operation_read.name
  member  = "serviceAccount:${local.executor}"
}

resource "google_service_account_iam_member" "executor_runtime" {
  for_each           = local.components
  service_account_id = google_service_account.runtime[each.key].name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${local.executor}"
}

resource "google_compute_region_network_endpoint_group" "app" {
  for_each              = local.backends
  project               = var.project_id
  name                  = "stara-${each.key}"
  region                = var.region
  network_endpoint_type = "SERVERLESS"
  cloud_run {
    service = google_cloud_run_v2_service.app[each.key].name
  }
}

resource "google_compute_backend_service" "app" {
  for_each              = local.backends
  project               = var.project_id
  name                  = "stara-${each.key}"
  protocol              = "HTTP"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  enable_cdn            = false
  backend {
    group = google_compute_region_network_endpoint_group.app[each.key].id
  }
  iap {
    enabled = true
  }
  depends_on = [google_cloud_run_v2_service_iam_member.iap_invoker]
}

resource "google_iap_web_backend_service_iam_member" "users" {
  for_each            = local.iap_grants
  project             = var.project_id
  web_backend_service = google_compute_backend_service.app[each.value.component].name
  role                = "roles/iap.httpsResourceAccessor"
  member              = each.value.member
}

resource "google_iap_web_backend_service_iam_member" "executor" {
  for_each            = local.backends
  project             = var.project_id
  web_backend_service = google_compute_backend_service.app[each.key].name
  role                = "roles/iap.httpsResourceAccessor"
  member              = "serviceAccount:${var.staging_executor_service_account}"
}

resource "google_compute_url_map" "staging" {
  count           = var.enable_load_balancer ? 1 : 0
  project         = var.project_id
  name            = "stara-staging"
  default_service = google_compute_backend_service.app["web"].id
  host_rule {
    hosts        = [var.hostname]
    path_matcher = "stara"
  }
  path_matcher {
    name            = "stara"
    default_service = google_compute_backend_service.app["web"].id
    path_rule {
      paths   = ["/api", "/api/*"]
      service = google_compute_backend_service.app["api"].id
    }
  }
}

resource "google_certificate_manager_dns_authorization" "staging" {
  count      = var.enable_load_balancer ? 1 : 0
  project    = var.project_id
  name       = "stara-staging"
  location   = "global"
  domain     = var.hostname
  type       = "PER_PROJECT_RECORD"
  depends_on = [google_project_service.api]
}

resource "google_certificate_manager_certificate" "staging" {
  count    = var.enable_load_balancer ? 1 : 0
  project  = var.project_id
  name     = "stara-staging"
  location = "global"
  managed {
    domains            = [var.hostname]
    dns_authorizations = [google_certificate_manager_dns_authorization.staging[0].id]
  }
}

resource "google_certificate_manager_certificate_map" "staging" {
  count      = var.enable_load_balancer ? 1 : 0
  project    = var.project_id
  name       = "stara-staging"
  depends_on = [google_project_service.api]
}

resource "google_certificate_manager_certificate_map_entry" "staging" {
  count        = var.enable_load_balancer ? 1 : 0
  project      = var.project_id
  name         = "stara-staging"
  map          = google_certificate_manager_certificate_map.staging[0].name
  hostname     = var.hostname
  certificates = [google_certificate_manager_certificate.staging[0].id]
}

resource "google_compute_ssl_policy" "staging" {
  count           = var.enable_load_balancer ? 1 : 0
  project         = var.project_id
  name            = "stara-staging"
  profile         = "MODERN"
  min_tls_version = "TLS_1_2"
  depends_on      = [google_project_service.api]
}

resource "google_compute_target_https_proxy" "staging" {
  count           = var.enable_load_balancer ? 1 : 0
  project         = var.project_id
  name            = "stara-staging"
  url_map         = google_compute_url_map.staging[0].id
  ssl_policy      = google_compute_ssl_policy.staging[0].id
  certificate_map = "//certificatemanager.googleapis.com/${google_certificate_manager_certificate_map.staging[0].id}"
  depends_on      = [google_certificate_manager_certificate_map_entry.staging]
}

resource "google_compute_global_address" "staging" {
  count        = var.enable_load_balancer ? 1 : 0
  project      = var.project_id
  name         = "stara-staging"
  address_type = "EXTERNAL"
  depends_on   = [google_project_service.api]
}

resource "google_compute_global_forwarding_rule" "staging" {
  count                 = var.enable_load_balancer ? 1 : 0
  project               = var.project_id
  name                  = "stara-staging-https"
  ip_address            = google_compute_global_address.staging[0].address
  port_range            = "443"
  ip_protocol           = "TCP"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  target                = google_compute_target_https_proxy.staging[0].id
}
