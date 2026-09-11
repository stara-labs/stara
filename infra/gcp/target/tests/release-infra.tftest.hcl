# Independent plan-only tests. This file's synthetic bytes stand in for backup
# input; passing them does not prove an actual bootstrap state was backed up.
mock_provider "google" {
  override_during = plan
  mock_resource "google_certificate_manager_dns_authorization" {
    defaults = {
      dns_resource_record = [{ name = "_synthetic.staging.app.stara.co.", type = "CNAME", data = "synthetic.authorize.certificatemanager.goog." }]
    }
  }
  mock_resource "google_compute_global_address" {
    defaults = { address = "192.0.2.10" }
  }
}

mock_provider "google-beta" {
  override_during = plan
}

override_resource {
  target          = google_service_account.runtime["web"]
  override_during = plan
  values = {
    email = "stara-web@stara-test-staging.iam.gserviceaccount.com"
    name  = "projects/stara-test-staging/serviceAccounts/stara-web@stara-test-staging.iam.gserviceaccount.com"
  }
}
override_resource {
  target          = google_service_account.runtime["api"]
  override_during = plan
  values = {
    email = "stara-api@stara-test-staging.iam.gserviceaccount.com"
    name  = "projects/stara-test-staging/serviceAccounts/stara-api@stara-test-staging.iam.gserviceaccount.com"
  }
}
override_resource {
  target          = google_project_service_identity.run
  override_during = plan
  values = {
    email  = "service-900000000002@serverless-robot-prod.iam.gserviceaccount.com"
    member = "serviceAccount:service-900000000002@serverless-robot-prod.iam.gserviceaccount.com"
  }
}
override_resource {
  target          = google_project_service_identity.iap
  override_during = plan
  values = {
    email  = "service-900000000002@gcp-sa-iap.iam.gserviceaccount.com"
    member = "serviceAccount:service-900000000002@gcp-sa-iap.iam.gserviceaccount.com"
  }
}

variables {
  project_id                       = "stara-test-staging"
  delivery_project_id              = "stara-test-delivery"
  environment                      = "staging"
  artifact_bucket                  = "stara-test-delivery-release-artifacts"
  staging_executor_service_account = "stara-executor@stara-test-delivery.iam.gserviceaccount.com"
  iap_users                        = ["user:release-owner@example.invalid"]
  initial_images = {
    web = "us-central1-docker.pkg.dev/stara-test-delivery/app/web@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    api = "us-central1-docker.pkg.dev/stara-test-delivery/app/api@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  }
  bootstrap_state_backup_path = abspath("tests/release-infra.tftest.hcl")
  bootstrap_state_sha256      = filesha256("tests/release-infra.tftest.hcl")
}

override_resource {
  target          = google_project_iam_custom_role.executor_service_update
  override_during = plan
  values          = { name = "projects/stara-test-staging/roles/staraReleaseServiceUpdate" }
}
override_resource {
  target          = google_project_iam_custom_role.executor_operation_read
  override_during = plan
  values          = { name = "projects/stara-test-staging/roles/staraReleaseOperationRead" }
}
override_resource {
  target          = google_compute_region_network_endpoint_group.app["web"]
  override_during = plan
  values          = { id = "projects/stara-test-staging/regions/us-central1/networkEndpointGroups/stara-web" }
}
override_resource {
  target          = google_compute_region_network_endpoint_group.app["api"]
  override_during = plan
  values          = { id = "projects/stara-test-staging/regions/us-central1/networkEndpointGroups/stara-api" }
}
override_resource {
  target          = google_compute_backend_service.app["web"]
  override_during = plan
  values          = { id = "projects/stara-test-staging/global/backendServices/stara-web" }
}
override_resource {
  target          = google_compute_backend_service.app["api"]
  override_during = plan
  values          = { id = "projects/stara-test-staging/global/backendServices/stara-api" }
}
override_resource {
  target          = google_compute_target_https_proxy.staging[0]
  override_during = plan
  values          = { id = "projects/stara-test-staging/global/targetHttpsProxies/stara-staging" }
}

run "staging_services_have_separate_identities_private_ingress_and_bounded_cost" {
  command = plan
  assert {
    condition = (
      toset(keys(google_cloud_run_v2_service.app)) == toset(["web", "api"]) &&
      toset(keys(google_service_account.runtime)) == toset(["web", "api"]) &&
      google_service_account.runtime["web"].email != google_service_account.runtime["api"].email &&
      length(google_service_account.isolation_executor) == 0 && alltrue([
        for key, service in google_cloud_run_v2_service.app :
        service.project == var.project_id && service.location == "us-central1" &&
        service.ingress == "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER" &&
        !service.invoker_iam_disabled && service.default_uri_disabled && service.deletion_protection &&
        service.template[0].service_account == google_service_account.runtime[key].email &&
        service.scaling[0].min_instance_count == 0 && service.scaling[0].max_instance_count == 2 &&
        service.template[0].scaling[0].min_instance_count == 0 && service.template[0].scaling[0].max_instance_count == 2 &&
        service.template[0].execution_environment == "EXECUTION_ENVIRONMENT_GEN2" &&
        service.template[0].containers[0].image == var.initial_images[key] &&
        service.template[0].containers[0].resources[0].limits.cpu == "1" &&
        service.template[0].containers[0].resources[0].limits.memory == "512Mi" &&
        service.template[0].containers[0].resources[0].cpu_idle &&
        !service.template[0].containers[0].resources[0].startup_cpu_boost &&
        service.template[0].containers[0].ports[0].container_port == 8080
      ])
    )
    error_message = "Both staging services must use separate identities, pinned images, private invoker/ingress restrictions and min-zero/max-two request-based resources."
  }
}

run "target_owns_private_configuration_and_receipt_state" {
  command = plan
  assert {
    condition = google_storage_bucket.config.name != google_storage_bucket.state.name && alltrue([
      for bucket in [google_storage_bucket.config, google_storage_bucket.state] :
      bucket.project == var.project_id && lower(bucket.location) == "us-central1" &&
      bucket.uniform_bucket_level_access && bucket.public_access_prevention == "enforced" &&
      !bucket.force_destroy && bucket.versioning[0].enabled
    ])
    error_message = "Config and receipts must use distinct target-owned private, versioned buckets, not delivery or Terraform state."
  }
  assert {
    condition = (
      google_storage_bucket_iam_member.executor_config.bucket == google_storage_bucket.config.name &&
      google_storage_bucket_iam_member.executor_config.role == "roles/storage.objectViewer" &&
      google_storage_bucket_iam_member.executor_config.member == "serviceAccount:${var.staging_executor_service_account}" &&
      google_storage_bucket_iam_member.executor_state.bucket == google_storage_bucket.state.name &&
      google_storage_bucket_iam_member.executor_state.role == "roles/storage.objectAdmin" &&
      google_storage_bucket_iam_member.executor_state.member == "serviceAccount:${var.staging_executor_service_account}" &&
      !strcontains(google_storage_bucket_iam_member.executor_state.bucket, "tfstate") &&
      google_storage_bucket_object.configuration.bucket == google_storage_bucket.config.name &&
      google_storage_bucket_object.configuration.name == "targets/staging.json" &&
      google_storage_bucket_object.configuration.cache_control == "no-store"
    )
    error_message = "Only the staging executor may read target config and mutate its receipt bucket; Terraform state is not executor state."
  }
}

run "private_configuration_binds_actual_planned_resources_and_delivery_logging" {
  command = plan
  assert {
    condition = toset(keys(jsondecode(google_storage_bucket_object.configuration.content))) == toset([
      "schemaVersion", "targetId", "environment", "policy", "projectId", "region", "services",
      "runtimeServiceAccounts", "imageRepositories", "artifactBucket", "stateBucket",
      "stagingOrigin", "executorServiceAccount", "loggingProjectId"
    ])
    error_message = "Private configuration must contain exactly the reviewed fields, without secrets or self-declared configuration hashes."
  }
  assert {
    condition = (
      jsondecode(google_storage_bucket_object.configuration.content).projectId == var.project_id &&
      jsondecode(google_storage_bucket_object.configuration.content).loggingProjectId == var.delivery_project_id &&
      jsondecode(google_storage_bucket_object.configuration.content).stateBucket == google_storage_bucket.state.name &&
      jsondecode(google_storage_bucket_object.configuration.content).executorServiceAccount == var.staging_executor_service_account &&
      jsondecode(google_storage_bucket_object.configuration.content).environment == "staging" &&
      jsondecode(google_storage_bucket_object.configuration.content).stagingOrigin == "https://staging.app.stara.co" &&
      jsondecode(google_storage_bucket_object.configuration.content).policy.repositoryId == "1363262992" &&
      jsondecode(google_storage_bucket_object.configuration.content).policy.workflows.scaffold.workflowRef == "stara-labs/stara/.github/workflows/checks.yml@refs/heads/main" &&
      jsondecode(google_storage_bucket_object.configuration.content).policy.workflows.images.workflowRef == "stara-labs/stara/.github/workflows/release.yml@refs/heads/main" &&
      jsondecode(google_storage_bucket_object.configuration.content).policy.provenanceWorkflowRef == "stara-labs/stara/.github/workflows/release.yml@refs/heads/main" &&
      toset(jsondecode(google_storage_bucket_object.configuration.content).policy.requiredTargets) == toset(["@stara/web", "@stara/ui", "@stara/api", "@stara/tooling"]) &&
      output.configuration_sha256 == sha256(google_storage_bucket_object.configuration.content) && alltrue([
        for component in ["web", "api"] :
        jsondecode(google_storage_bucket_object.configuration.content).services[component] == google_cloud_run_v2_service.app[component].name &&
        jsondecode(google_storage_bucket_object.configuration.content).runtimeServiceAccounts[component] == google_service_account.runtime[component].email &&
        jsondecode(google_storage_bucket_object.configuration.content).imageRepositories[component] == "us-central1-docker.pkg.dev/${var.delivery_project_id}/app/${component}"
      ])
    )
    error_message = "Config identity and every operational endpoint must come from the actual target/delivery resources and fixed trust roots."
  }
}

run "executor_grants_are_target_scoped_and_runtime_accounts_have_no_project_authority" {
  command = plan
  assert {
    condition = (
      toset(google_project_iam_custom_role.executor_service_update.permissions) == toset(["run.services.get", "run.services.update", "run.revisions.get", "run.revisions.list"]) &&
      toset(google_project_iam_custom_role.executor_operation_read.permissions) == toset(["run.operations.get"]) &&
      google_project_iam_member.executor_operation_read.project == var.project_id &&
      google_project_iam_member.executor_operation_read.member == "serviceAccount:${var.staging_executor_service_account}" &&
      google_project_iam_member.executor_operation_read.role == google_project_iam_custom_role.executor_operation_read.name && alltrue([
        for key, binding in google_cloud_run_v2_service_iam_binding.executor_service_update :
        binding.project == var.project_id && binding.name == google_cloud_run_v2_service.app[key].name &&
        binding.role == google_project_iam_custom_role.executor_service_update.name &&
        toset(binding.members) == toset(["serviceAccount:${var.staging_executor_service_account}"])
        ]) && alltrue([
        for key, grant in google_service_account_iam_member.executor_runtime :
        grant.service_account_id == google_service_account.runtime[key].name &&
        grant.member == "serviceAccount:${var.staging_executor_service_account}" && grant.role == "roles/iam.serviceAccountUser"
      ])
    )
    error_message = "Executor may update only existing target services, read target operations, and act as the two target runtime accounts."
  }
  assert {
    condition = alltrue([
      for grant in [google_project_iam_member.run_agent, google_project_iam_member.iap_agent, google_project_iam_member.executor_operation_read] :
      !contains(["serviceAccount:${google_service_account.runtime["web"].email}", "serviceAccount:${google_service_account.runtime["api"].email}"], grant.member) &&
      !contains(["roles/owner", "roles/editor", "roles/iam.serviceAccountTokenCreator"], grant.role)
    ])
    error_message = "Declared project grants must not confer runtime-account or broad owner/editor/token-creator authority. Inherited IAM remains unproven."
  }
}

run "https_iap_protects_web_and_api_without_direct_url_or_anonymous_invoker" {
  command = plan
  assert {
    condition = length(google_cloud_run_v2_service_iam_member.iap_invoker) == 2 && alltrue([
      for key, grant in google_cloud_run_v2_service_iam_member.iap_invoker :
      grant.member == google_project_service_identity.iap.member && grant.role == "roles/run.invoker" &&
      grant.name == google_cloud_run_v2_service.app[key].name && grant.project == var.project_id
      ]) && length(google_compute_backend_service.app) == 2 && alltrue([
      for key, backend in google_compute_backend_service.app :
      backend.iap[0].enabled && !backend.enable_cdn &&
      one(backend.backend).group == google_compute_region_network_endpoint_group.app[key].id &&
      google_compute_region_network_endpoint_group.app[key].cloud_run[0].service == google_cloud_run_v2_service.app[key].name
    ])
    error_message = "IAP must protect both service backends and be the only declared service-invoker principal."
  }
  assert {
    condition = length(google_iap_web_backend_service_iam_member.users) == 2 && alltrue([
      for grant in google_iap_web_backend_service_iam_member.users :
      grant.project == var.project_id && grant.role == "roles/iap.httpsResourceAccessor" && contains(var.iap_users, grant.member) &&
      contains([for backend in google_compute_backend_service.app : backend.name], grant.web_backend_service)
      ]) && length(google_iap_web_backend_service_iam_member.executor) == 2 && alltrue([
      for key, grant in google_iap_web_backend_service_iam_member.executor :
      grant.project == var.project_id && grant.web_backend_service == google_compute_backend_service.app[key].name &&
      grant.role == "roles/iap.httpsResourceAccessor" && grant.member == "serviceAccount:${var.staging_executor_service_account}"
    ])
    error_message = "Only explicit users and the private probe executor receive IAP backend access."
  }
  assert {
    condition = (
      google_compute_url_map.staging[0].default_service == google_compute_backend_service.app["web"].id &&
      one(google_compute_url_map.staging[0].path_matcher).default_service == google_compute_backend_service.app["web"].id &&
      one(one(google_compute_url_map.staging[0].path_matcher).path_rule).service == google_compute_backend_service.app["api"].id &&
      toset(one(one(google_compute_url_map.staging[0].path_matcher).path_rule).paths) == toset(["/api", "/api/*"]) &&
      toset(one(google_compute_url_map.staging[0].host_rule).hosts) == toset(["staging.app.stara.co"]) &&
      google_compute_global_forwarding_rule.staging[0].port_range == "443" &&
      google_compute_global_forwarding_rule.staging[0].target == google_compute_target_https_proxy.staging[0].id &&
      google_compute_ssl_policy.staging[0].min_tls_version == "TLS_1_2" &&
      toset(google_certificate_manager_certificate.staging[0].managed[0].domains) == toset(["staging.app.stara.co"]) &&
      length(output.dns_records) == 2
    )
    error_message = "HTTPS routing/certificate must cover only staging, with API paths directed to API and no production origin."
  }
}

run "isolation_owns_its_executor_and_state_without_lb_or_staging_grants" {
  command = plan
  variables {
    project_id                       = "stara-test-isolation"
    environment                      = "isolation"
    enable_load_balancer             = false
    iap_users                        = []
    staging_executor_service_account = null
  }
  override_resource {
    target          = google_project_iam_custom_role.executor_service_update
    override_during = plan
    values          = { name = "projects/stara-test-isolation/roles/staraReleaseServiceUpdate" }
  }
  override_resource {
    target          = google_project_iam_custom_role.executor_operation_read
    override_during = plan
    values          = { name = "projects/stara-test-isolation/roles/staraReleaseOperationRead" }
  }
  override_resource {
    target          = google_service_account.isolation_executor[0]
    override_during = plan
    values = {
      email = "stara-isolation-executor@stara-test-isolation.iam.gserviceaccount.com"
      name  = "projects/stara-test-isolation/serviceAccounts/stara-isolation-executor@stara-test-isolation.iam.gserviceaccount.com"
    }
  }
  override_resource {
    target          = google_service_account.runtime["web"]
    override_during = plan
    values = {
      email = "stara-web@stara-test-isolation.iam.gserviceaccount.com"
      name  = "projects/stara-test-isolation/serviceAccounts/stara-web@stara-test-isolation.iam.gserviceaccount.com"
    }
  }
  override_resource {
    target          = google_service_account.runtime["api"]
    override_during = plan
    values = {
      email = "stara-api@stara-test-isolation.iam.gserviceaccount.com"
      name  = "projects/stara-test-isolation/serviceAccounts/stara-api@stara-test-isolation.iam.gserviceaccount.com"
    }
  }
  override_resource {
    target          = google_project_service_identity.run
    override_during = plan
    values          = { member = "serviceAccount:service-900000000003@serverless-robot-prod.iam.gserviceaccount.com" }
  }
  override_resource {
    target          = google_project_service_identity.iap
    override_during = plan
    values          = { member = "serviceAccount:service-900000000003@gcp-sa-iap.iam.gserviceaccount.com" }
  }
  assert {
    condition = (
      length(google_service_account.isolation_executor) == 1 &&
      google_service_account.isolation_executor[0].project == "stara-test-isolation" &&
      google_storage_bucket.config.project == "stara-test-isolation" &&
      google_storage_bucket.state.project == "stara-test-isolation" &&
      google_storage_bucket_iam_member.executor_state.member == "serviceAccount:${google_service_account.isolation_executor[0].email}" &&
      google_storage_bucket_iam_member.executor_config.member == "serviceAccount:${google_service_account.isolation_executor[0].email}" &&
      jsondecode(google_storage_bucket_object.configuration.content).environment == "isolation" &&
      jsondecode(google_storage_bucket_object.configuration.content).executorServiceAccount == google_service_account.isolation_executor[0].email &&
      jsondecode(google_storage_bucket_object.configuration.content).loggingProjectId == var.delivery_project_id && alltrue([
        for grant in google_cloud_run_v2_service_iam_binding.executor_service_update :
        grant.project == "stara-test-isolation" && toset(grant.members) == toset(["serviceAccount:${google_service_account.isolation_executor[0].email}"])
      ])
    )
    error_message = "Isolation must have its own project, executor, config, receipts and service-update authority; staging executor must not receive those grants."
  }
  assert {
    condition = (
      length(google_compute_backend_service.app) == 0 && length(google_compute_region_network_endpoint_group.app) == 0 &&
      length(google_compute_url_map.staging) == 0 && length(google_compute_target_https_proxy.staging) == 0 &&
      length(google_compute_global_forwarding_rule.staging) == 0 && length(google_compute_global_address.staging) == 0 &&
      length(google_certificate_manager_certificate.staging) == 0 && length(google_certificate_manager_dns_authorization.staging) == 0 &&
      length(google_iap_web_backend_service_iam_member.users) == 0 && length(google_iap_web_backend_service_iam_member.executor) == 0 &&
      length(output.dns_records) == 0 &&
      google_storage_bucket_iam_member.isolation_artifacts[0].bucket == var.artifact_bucket &&
      google_storage_bucket_iam_member.isolation_artifacts[0].role == "roles/storage.objectViewer" &&
      google_storage_bucket_iam_member.isolation_artifacts[0].member == "serviceAccount:${google_service_account.isolation_executor[0].email}" &&
      google_artifact_registry_repository_iam_member.isolation_image_reader[0].role == "roles/artifactregistry.reader" &&
      google_artifact_registry_repository_iam_member.isolation_image_reader[0].project == var.delivery_project_id &&
      google_artifact_registry_repository_iam_member.isolation_image_reader[0].repository == "app" &&
      google_artifact_registry_repository_iam_member.isolation_image_reader[0].member == "serviceAccount:${google_service_account.isolation_executor[0].email}"
    )
    error_message = "Isolation must have no LB/certificate/DNS/IAP frontend and only shared immutable artifact read permissions."
  }
}

run "reject_production_environment" {
  command = plan
  variables { environment = "production" }
  expect_failures = [var.environment]
}
run "reject_production_project" {
  command = plan
  variables { project_id = "stara-production" }
  expect_failures = [var.project_id]
}
run "reject_production_hostname" {
  command = plan
  variables { hostname = "app.stara.co" }
  expect_failures = [var.hostname]
}
run "reject_foreign_region" {
  command = plan
  variables { region = "europe-west1" }
  expect_failures = [var.region]
}
run "reject_delivery_reused_as_target" {
  command = plan
  variables { project_id = "stara-test-delivery" }
  expect_failures = [var.delivery_project_id]
}
run "reject_missing_staging_executor" {
  command = plan
  variables { staging_executor_service_account = null }
  expect_failures = [var.staging_executor_service_account]
}
run "reject_empty_iap_allowlist" {
  command = plan
  variables { iap_users = [] }
  expect_failures = [var.iap_users]
}
run "reject_anonymous_iap_allowlist" {
  command = plan
  variables { iap_users = ["allUsers"] }
  expect_failures = [var.iap_users]
}
run "reject_isolation_lb" {
  command = plan
  variables {
    environment                      = "isolation"
    staging_executor_service_account = null
    enable_load_balancer             = true
  }
  expect_failures = [var.enable_load_balancer]
}
run "reject_staging_executor_in_isolation" {
  command = plan
  variables {
    environment          = "isolation"
    enable_load_balancer = false
  }
  expect_failures = [var.staging_executor_service_account]
}
run "reject_mutable_initial_image" {
  command = plan
  variables {
    initial_images = {
      web = "us-central1-docker.pkg.dev/stara-test-delivery/app/web:latest"
      api = "us-central1-docker.pkg.dev/stara-test-delivery/app/api@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    }
  }
  expect_failures = [var.initial_images]
}
run "reject_foreign_artifact_bucket" {
  command = plan
  variables { artifact_bucket = "foreign-private-artifacts" }
  expect_failures = [var.artifact_bucket]
}
run "reject_missing_private_backup" {
  command = plan
  variables { bootstrap_state_backup_path = abspath("tests/absent-synthetic-backup.json") }
  expect_failures = [var.bootstrap_state_backup_path]
}
run "reject_relative_backup" {
  command = plan
  variables { bootstrap_state_backup_path = "tests/release-infra.tftest.hcl" }
  expect_failures = [var.bootstrap_state_backup_path]
}
run "reject_mismatched_backup_hash" {
  command = plan
  variables { bootstrap_state_sha256 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }
  expect_failures = [var.bootstrap_state_backup_path]
}
run "reject_malformed_private_hash" {
  command = plan
  variables { bootstrap_state_sha256 = "" }
  expect_failures = [var.bootstrap_state_sha256]
}

run "private_policy_requires_dynamic_codeql_and_both_analysis_jobs" {
  command = plan
  assert {
    condition = try(
      jsondecode(google_storage_bucket_object.configuration.content).policy.workflows.codeql.workflowRef == "dynamic/github-code-scanning/codeql" &&
      alltrue([for name in ["Analyze (javascript-typescript)", "Analyze (actions)"] : contains(jsondecode(google_storage_bucket_object.configuration.content).policy.workflows.codeql.jobs, name)]) &&
      length(distinct(jsondecode(google_storage_bucket_object.configuration.content).policy.workflows.codeql.jobs)) == length(jsondecode(google_storage_bucket_object.configuration.content).policy.workflows.codeql.jobs),
      false
    )
    error_message = "Private executor policy must require the fixed dynamic CodeQL workflow and both complete analysis jobs, without duplicate job identities."
  }
}
