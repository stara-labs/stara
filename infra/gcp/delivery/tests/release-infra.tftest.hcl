# Independent plan-only tests. Mock only server-computed identities, never IAM inputs.
mock_provider "google" {
  override_during = plan
  mock_data "google_project" {
    defaults = { number = "900000000001" }
  }
  mock_resource "google_monitoring_notification_channel" {
    defaults = { name = "projects/stara-test-delivery/notificationChannels/900000000001" }
  }
}

mock_provider "google" {
  alias           = "alternate_project_number"
  override_during = plan
  mock_data "google_project" {
    defaults = { number = "900000000099" }
  }
}

mock_provider "google-beta" {
  override_during = plan
  mock_resource "google_project_service_identity" {
    defaults = {
      email  = "900000000001@cloudbuild.gserviceaccount.com"
      member = "serviceAccount:900000000001@cloudbuild.gserviceaccount.com"
    }
  }
}

override_resource {
  target          = google_service_account.artifact_publisher
  override_during = plan
  values = {
    name  = "projects/stara-test-delivery/serviceAccounts/stara-artifact-publisher@stara-test-delivery.iam.gserviceaccount.com"
    email = "stara-artifact-publisher@stara-test-delivery.iam.gserviceaccount.com"
  }
}
override_resource {
  target          = google_service_account.dispatcher
  override_during = plan
  values = {
    name  = "projects/stara-test-delivery/serviceAccounts/stara-dispatcher@stara-test-delivery.iam.gserviceaccount.com"
    email = "stara-dispatcher@stara-test-delivery.iam.gserviceaccount.com"
  }
}
override_resource {
  target          = google_service_account.executor
  override_during = plan
  values = {
    name  = "projects/stara-test-delivery/serviceAccounts/stara-executor@stara-test-delivery.iam.gserviceaccount.com"
    email = "stara-executor@stara-test-delivery.iam.gserviceaccount.com"
  }
}
override_resource {
  target          = google_iam_workload_identity_pool.publisher["images"]
  override_during = plan
  values          = { name = "projects/900000000001/locations/global/workloadIdentityPools/stara-images" }
}
override_resource {
  target          = google_iam_workload_identity_pool.publisher["dispatch"]
  override_during = plan
  values          = { name = "projects/900000000001/locations/global/workloadIdentityPools/stara-dispatch" }
}

variables {
  project_id         = "stara-test-delivery"
  staging_project_id = "stara-test-staging"
  operator_email     = "release-owner@example.invalid"
  executor_image     = "us-central1-docker.pkg.dev/stara-test-delivery/control/executor@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
}

override_resource {
  target          = google_artifact_registry_repository.app
  override_during = plan
  values          = { name = "projects/stara-test-delivery/locations/us-central1/repositories/app" }
}
override_resource {
  target          = google_artifact_registry_repository.control
  override_during = plan
  values          = { name = "projects/stara-test-delivery/locations/us-central1/repositories/control" }
}
override_resource {
  target          = google_project_iam_custom_role.executor_sign_jwt
  override_during = plan
  values          = { name = "projects/stara-test-delivery/roles/staraExecutorSignJwt" }
}
override_resource {
  target          = google_pubsub_topic.staging
  override_during = plan
  values          = { id = "projects/stara-test-delivery/topics/stara-staging-candidates" }
}

run "cloud_build_service_agent_is_not_the_generated_legacy_build_account" {
  command = plan
  assert {
    condition = (
      google_project_iam_member.cloud_build_agent.project == var.project_id &&
      google_project_iam_member.cloud_build_agent.role == "roles/cloudbuild.serviceAgent" &&
      google_project_iam_member.cloud_build_agent.member == "serviceAccount:service-900000000001@gcp-sa-cloudbuild.iam.gserviceaccount.com"
    )
    error_message = "The privileged Cloud Build service-agent role belongs only to the actual delivery service agent derived from project metadata."
  }
  assert {
    condition = (
      google_project_service_identity.cloud_build.email == "900000000001@cloudbuild.gserviceaccount.com" &&
      google_project_service_identity.cloud_build.member == "serviceAccount:900000000001@cloudbuild.gserviceaccount.com" &&
      google_project_iam_member.cloud_build_agent.member != google_project_service_identity.cloud_build.member &&
      !endswith(google_project_iam_member.cloud_build_agent.member, "@cloudbuild.gserviceaccount.com")
    )
    error_message = "The generated legacy build identity must never receive roles/cloudbuild.serviceAgent."
  }
}

run "service_agent_number_comes_from_project_metadata_not_identity_output" {
  command = plan
  providers = {
    google      = google.alternate_project_number
    google-beta = google-beta
  }
  assert {
    condition = (
      google_project_iam_member.cloud_build_agent.project == var.project_id &&
      google_project_iam_member.cloud_build_agent.role == "roles/cloudbuild.serviceAgent" &&
      google_project_iam_member.cloud_build_agent.member == "serviceAccount:service-900000000099@gcp-sa-cloudbuild.iam.gserviceaccount.com" &&
      google_project_iam_member.cloud_build_agent.member != google_project_service_identity.cloud_build.member
    )
    error_message = "Changing mocked project metadata must change the exact service-agent principal independently of the generated identity output."
  }
}

run "publishers_have_distinct_narrow_resource_grants" {
  command = plan
  assert {
    condition = (
      google_service_account.artifact_publisher.email != google_service_account.dispatcher.email &&
      google_service_account.executor.email != google_service_account.artifact_publisher.email &&
      google_service_account.executor.email != google_service_account.dispatcher.email &&
      google_artifact_registry_repository_iam_member.publish_images.member == "serviceAccount:${google_service_account.artifact_publisher.email}" &&
      google_artifact_registry_repository_iam_member.publish_images.repository == google_artifact_registry_repository.app.name &&
      google_artifact_registry_repository_iam_member.publish_images.role == "roles/artifactregistry.writer" &&
      google_storage_bucket_iam_member.publish_artifacts.member == "serviceAccount:${google_service_account.artifact_publisher.email}" &&
      google_storage_bucket_iam_member.publish_artifacts.bucket == google_storage_bucket.artifacts.name &&
      google_storage_bucket_iam_member.publish_artifacts.role == "roles/storage.objectCreator" &&
      google_pubsub_topic_iam_member.dispatch.member == "serviceAccount:${google_service_account.dispatcher.email}" &&
      google_pubsub_topic_iam_member.dispatch.topic == google_pubsub_topic.staging.name &&
      google_pubsub_topic_iam_member.dispatch.role == "roles/pubsub.publisher"
    )
    error_message = "Image publication and staging dispatch must use different accounts with only their intended resource-scoped write grants."
  }
  assert {
    condition     = google_artifact_registry_repository.app.docker_config[0].immutable_tags && google_artifact_registry_repository.control.docker_config[0].immutable_tags && google_artifact_registry_repository.app.repository_id != google_artifact_registry_repository.control.repository_id
    error_message = "Application publication must remain separate from the reviewed immutable control image repository."
  }
}

run "federation_resolves_to_separate_workflow_scoped_principals" {
  command = plan
  assert {
    condition = (
      google_iam_workload_identity_pool_provider.images.workload_identity_pool_id != google_iam_workload_identity_pool_provider.dispatch.workload_identity_pool_id &&
      google_service_account_iam_member.image_federation.service_account_id == google_service_account.artifact_publisher.name &&
      google_service_account_iam_member.dispatch_federation.service_account_id == google_service_account.dispatcher.name &&
      google_service_account_iam_member.image_federation.role == "roles/iam.workloadIdentityUser" &&
      google_service_account_iam_member.dispatch_federation.role == "roles/iam.workloadIdentityUser" &&
      google_service_account_iam_member.image_federation.member == "principalSet://iam.googleapis.com/projects/900000000001/locations/global/workloadIdentityPools/stara-images/attribute.publisher/images" &&
      google_service_account_iam_member.dispatch_federation.member == "principalSet://iam.googleapis.com/projects/900000000001/locations/global/workloadIdentityPools/stara-dispatch/attribute.publisher/dispatch"
    )
    error_message = "The two workflows must not resolve to a shared impersonation principal or executor binding."
  }
  assert {
    condition = (alltrue([
      for provider in [google_iam_workload_identity_pool_provider.images, google_iam_workload_identity_pool_provider.dispatch] :
      provider.oidc[0].issuer_uri == "https://token.actions.githubusercontent.com" &&
      strcontains(provider.attribute_condition, "assertion.repository_owner_id == '293455507'") &&
      strcontains(provider.attribute_condition, "assertion.repository_id == '1363262992'") &&
      strcontains(provider.attribute_condition, "assertion.ref == 'refs/heads/main'") &&
      !strcontains(provider.attribute_condition, "||")
      ]) && strcontains(google_iam_workload_identity_pool_provider.images.attribute_condition, "assertion.workflow_ref == 'stara-labs/stara/.github/workflows/release.yml@refs/heads/main'") &&
      strcontains(google_iam_workload_identity_pool_provider.images.attribute_condition, "assertion.event_name == 'push'") &&
      strcontains(google_iam_workload_identity_pool_provider.dispatch.attribute_condition, "assertion.workflow_ref == 'stara-labs/stara/.github/workflows/dispatch.yml@refs/heads/main'") &&
    strcontains(google_iam_workload_identity_pool_provider.dispatch.attribute_condition, "assertion.event_name == 'workflow_run'"))
    error_message = "Evaluated provider inputs must retain exact numeric repository and workflow/ref/event trust roots. CEL and actual token exchange still require separate verification."
  }
}

run "private_artifacts_logging_and_own_account_signing" {
  command = plan
  assert {
    condition = (
      google_storage_bucket.artifacts.project == var.project_id &&
      google_storage_bucket.artifacts.uniform_bucket_level_access &&
      google_storage_bucket.artifacts.public_access_prevention == "enforced" &&
      google_storage_bucket.artifacts.versioning[0].enabled && !google_storage_bucket.artifacts.force_destroy &&
      google_storage_bucket_iam_member.executor_artifact_reader.role == "roles/storage.objectViewer" &&
      google_storage_bucket_iam_member.executor_artifact_reader.member == "serviceAccount:${google_service_account.executor.email}" &&
      google_storage_bucket_iam_member.executor_artifact_reader.bucket == google_storage_bucket.artifacts.name &&
      google_artifact_registry_repository_iam_member.executor_app_reader.repository == google_artifact_registry_repository.app.name &&
      google_artifact_registry_repository_iam_member.executor_control_reader.repository == google_artifact_registry_repository.control.name &&
      google_artifact_registry_repository_iam_member.executor_app_reader.role == "roles/artifactregistry.reader" &&
      google_artifact_registry_repository_iam_member.executor_control_reader.role == "roles/artifactregistry.reader" &&
      google_artifact_registry_repository_iam_member.executor_app_reader.member == "serviceAccount:${google_service_account.executor.email}" &&
      google_artifact_registry_repository_iam_member.executor_control_reader.member == "serviceAccount:${google_service_account.executor.email}" &&
      google_project_iam_member.executor_logs.project == var.project_id &&
      google_project_iam_member.executor_logs.role == "roles/logging.logWriter" &&
      google_project_iam_member.executor_logs.member == "serviceAccount:${google_service_account.executor.email}" &&
      google_logging_project_bucket_config.logs.retention_days == 30 &&
      google_logging_project_bucket_config.logs.project == var.project_id
    )
    error_message = "Artifacts and diagnostics must stay private; executor gets artifact reads and delivery log writes only."
  }
  assert {
    condition = (
      toset(google_project_iam_custom_role.executor_sign_jwt.permissions) == toset(["iam.serviceAccounts.signJwt"]) &&
      google_service_account_iam_member.executor_sign_jwt.role == google_project_iam_custom_role.executor_sign_jwt.name &&
      google_service_account_iam_member.executor_sign_jwt.service_account_id == google_service_account.executor.name &&
      google_service_account_iam_member.executor_sign_jwt.member == "serviceAccount:${google_service_account.executor.email}"
    )
    error_message = "Only the private executor may sign JWTs, on its own account and with the single signing permission."
  }
}

run "fixed_executor_disabled_until_reviewed_activation" {
  command = plan
  assert {
    condition = (
      google_cloudbuild_trigger.staging.disabled &&
      google_cloudbuild_trigger.staging.project == var.project_id &&
      google_cloudbuild_trigger.staging.location == "us-central1" &&
      google_cloudbuild_trigger.staging.service_account == google_service_account.executor.name &&
      google_cloudbuild_trigger.staging.pubsub_config[0].topic == google_pubsub_topic.staging.id &&
      google_cloudbuild_trigger.staging.build[0].step[0].name == var.executor_image &&
      google_cloudbuild_trigger.staging.build[0].step[0].entrypoint == "node" &&
      google_cloudbuild_trigger.staging.build[0].step[0].dir == "/app" &&
      length(google_cloudbuild_trigger.staging.build[0].step) == 1 &&
      length(google_cloudbuild_trigger.staging.build[0].step[0].args) == 2 &&
      google_cloudbuild_trigger.staging.build[0].step[0].args[0] == "tooling/release/cli.mjs" &&
      google_cloudbuild_trigger.staging.build[0].step[0].args[1] == "execute" &&
      google_cloudbuild_trigger.staging.build[0].timeout == "1800s" &&
      google_cloudbuild_trigger.staging.build[0].queue_ttl == "300s" &&
      google_cloudbuild_trigger.staging.build[0].options[0].logging == "CLOUD_LOGGING_ONLY"
    )
    error_message = "Dispatch must default disabled and bind one fixed private control image, identity, topic, entrypoint and bounded build."
  }
  assert {
    condition = (
      contains(google_cloudbuild_trigger.staging.build[0].step[0].env, "STARA_CONFIGURATION_URI=gs://stara-test-staging-release-config/targets/staging.json") &&
      contains(google_cloudbuild_trigger.staging.build[0].step[0].env, "STARA_DISPATCH_PAYLOAD=$_PAYLOAD") &&
      output.target_inputs.configuration_bucket == "stara-test-staging-release-config" &&
      output.target_inputs.state_bucket == "stara-test-staging-release-state"
    )
    error_message = "Delivery must reference the staging-owned config/state and treat the message only as data."
  }
}

run "corrective_incidents_resolve_to_owner_channel" {
  command = plan
  assert {
    condition = google_monitoring_notification_channel.operator.project == var.project_id && google_monitoring_notification_channel.operator.type == "email" && google_monitoring_notification_channel.operator.enabled && google_monitoring_notification_channel.operator.labels.email_address == var.operator_email && alltrue([
      for alert in [google_monitoring_alert_policy.release_terminal, google_monitoring_alert_policy.executor_crash] :
      alert.enabled && alert.project == var.project_id &&
      toset(alert.notification_channels) == toset([google_monitoring_notification_channel.operator.name]) &&
      alert.alert_strategy[0].notification_rate_limit[0].period == "300s"
    ])
    error_message = "Both terminal failure and executor crash policies need an enabled, correctly linked private owner channel. Plan equality does not prove email delivery."
  }
  assert {
    condition     = strcontains(google_monitoring_alert_policy.release_terminal.conditions[0].condition_matched_log[0].filter, "projects/stara-test-delivery/logs/stara-release") && strcontains(google_monitoring_alert_policy.release_terminal.conditions[0].condition_matched_log[0].filter, "release_terminal") && strcontains(google_monitoring_alert_policy.release_terminal.documentation[0].content, "reviewed repair PR") && strcontains(google_monitoring_alert_policy.release_terminal.documentation[0].content, "does not establish recovery")
    error_message = "Corrective incidents must target the delivery log and direct reviewed forward repair; inactivity closure cannot imply recovery."
  }
}

run "explicit_staging_activation_does_not_change_publishers" {
  command = plan
  variables { enable_dispatch = true }
  assert {
    condition     = !google_cloudbuild_trigger.staging.disabled && google_pubsub_topic_iam_member.dispatch.role == "roles/pubsub.publisher" && google_artifact_registry_repository_iam_member.publish_images.role == "roles/artifactregistry.writer"
    error_message = "Activation may enable only the configured staging trigger, without broadening publisher roles."
  }
}

run "reject_mutable_executor_image" {
  command = plan
  variables { executor_image = "us-central1-docker.pkg.dev/stara-test-delivery/control/executor:latest" }
  expect_failures = [var.executor_image]
}
run "reject_foreign_executor_image" {
  command = plan
  variables { executor_image = "us-central1-docker.pkg.dev/foreign-project/control/executor@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }
  expect_failures = [var.executor_image]
}
run "reject_missing_owner_email" {
  command = plan
  variables { operator_email = "" }
  expect_failures = [var.operator_email]
}
run "reject_reused_staging_project" {
  command = plan
  variables { staging_project_id = "stara-test-delivery" }
  expect_failures = [var.staging_project_id]
}
run "reject_production_target" {
  command = plan
  variables { staging_project_id = "stara-production" }
  expect_failures = [var.staging_project_id]
}
run "reject_foreign_region" {
  command = plan
  variables { region = "europe-west1" }
  expect_failures = [var.region]
}
