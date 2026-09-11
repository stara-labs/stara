# Independent plan-only tests. Computed project numbers are synthetic, not IAM evidence.
mock_provider "google" {
  override_during = plan
}

mock_provider "google" {
  alias           = "budget"
  override_during = plan
}

override_resource {
  target          = google_project.environment["delivery"]
  override_during = plan
  values = {
    number = "900000000001"
  }
}

override_resource {
  target          = google_project.environment["staging"]
  override_during = plan
  values = {
    number = "900000000002"
  }
}

variables {
  organization_id    = "123456789012"
  billing_account_id = "000000-000000-000000"
  project_ids = {
    delivery = "stara-test-delivery"
    staging  = "stara-test-staging"
  }
}

run "two_owned_projects_and_private_state" {
  command = plan

  assert {
    condition     = toset(keys(google_project.environment)) == toset(["delivery", "staging"])
    error_message = "Default bootstrap must create exactly delivery and staging, with no production or isolation project."
  }
  assert {
    condition = alltrue([
      for key, project in google_project.environment :
      project.project_id == var.project_ids[key] && project.org_id == var.organization_id &&
      project.billing_account == var.billing_account_id && !project.auto_create_network &&
      project.deletion_policy == "PREVENT" && project.labels.environment == key &&
      project.labels.application == "stara" && project.labels.data_class == "synthetic"
    ])
    error_message = "Projects must use supplied ownership/billing, no default network, protected lifecycle and synthetic Stara labels."
  }
  assert {
    condition = length(google_storage_bucket.terraform_state) == 2 && alltrue([
      for key, bucket in google_storage_bucket.terraform_state :
      bucket.project == google_project.environment[key].project_id &&
      bucket.name == "${var.project_ids[key]}-tfstate" && lower(bucket.location) == "us-central1" &&
      bucket.uniform_bucket_level_access && bucket.public_access_prevention == "enforced" &&
      !bucket.force_destroy && bucket.versioning[0].enabled
    ])
    error_message = "Each enabled project must own a distinct, versioned, nonpublic Terraform-state bucket."
  }
  assert {
    condition     = output.backend_configuration.delivery.bucket != output.backend_configuration.staging.bucket && output.backend_configuration.delivery.prefix != output.backend_configuration.staging.prefix
    error_message = "Target and delivery Terraform backends must stay separate."
  }
}

run "combined_budget_is_not_an_activation_or_shutdown_control" {
  command = plan

  assert {
    condition = (
      google_billing_budget.combined.amount[0].specified_amount[0].currency_code == "USD" &&
      google_billing_budget.combined.amount[0].specified_amount[0].units == "100" &&
      google_billing_budget.combined.budget_filter[0].calendar_period == "MONTH" &&
      toset(google_billing_budget.combined.budget_filter[0].projects) == toset(["projects/900000000001", "projects/900000000002"]) &&
      toset([for rule in google_billing_budget.combined.threshold_rules : rule.threshold_percent]) == toset([0.5, 0.8, 1.0]) &&
      length(google_billing_budget.combined.threshold_rules) == 3
    )
    error_message = "Combined monthly USD 100 budget must cover exactly enabled projects and alert at 50/80/100 percent."
  }
  assert {
    condition     = length(google_billing_budget.combined.all_updates_rule) == 0
    error_message = "Without custom channels, omit the optional notifications block so API-default IAM recipients remain enabled without perpetual drift."
  }
}

run "custom_budget_channels_add_to_default_iam_recipients" {
  command = plan
  variables {
    budget_notification_channels = [
      "projects/stara-test-delivery/notificationChannels/1001",
      "projects/stara-test-delivery/notificationChannels/1002",
    ]
  }
  assert {
    condition     = length(google_billing_budget.combined.all_updates_rule) == 1
    error_message = "Custom budget channels must produce exactly one notifications block."
  }
  assert {
    condition = try(
      tolist(google_billing_budget.combined.all_updates_rule[0].monitoring_notification_channels) == var.budget_notification_channels &&
      google_billing_budget.combined.all_updates_rule[0].disable_default_iam_recipients == false,
      false,
    )
    error_message = "Custom channels must match the supplied list exactly and must not disable default IAM recipients."
  }
}

run "accept_five_budget_notification_channels" {
  command = plan
  variables {
    budget_notification_channels = [for number in range(5) : "projects/stara-test-delivery/notificationChannels/${1001 + number}"]
  }
  assert {
    condition = length(google_billing_budget.combined.all_updates_rule) == 1 && try(
      tolist(google_billing_budget.combined.all_updates_rule[0].monitoring_notification_channels) == var.budget_notification_channels &&
      google_billing_budget.combined.all_updates_rule[0].disable_default_iam_recipients == false,
      false,
    )
    error_message = "All five supported custom channels must remain configured alongside default IAM recipients."
  }
}

run "reject_six_budget_notification_channels" {
  command = plan
  variables {
    budget_notification_channels = [for number in range(6) : "projects/stara-test-delivery/notificationChannels/${1001 + number}"]
  }
  expect_failures = [var.budget_notification_channels]
}

run "optional_isolation_is_third_distinct_owned_project_in_budget" {
  command = plan
  variables {
    project_ids = {
      delivery  = "stara-test-delivery"
      staging   = "stara-test-staging"
      isolation = "stara-test-isolation"
    }
  }
  override_resource {
    target          = google_project.environment["isolation"]
    override_during = plan
    values = {
      number = "900000000003"
    }
  }
  assert {
    condition     = toset(keys(google_project.environment)) == toset(["delivery", "staging", "isolation"]) && length(distinct([for project in google_project.environment : project.project_id])) == 3
    error_message = "Isolation must add exactly one distinct owned project, never production."
  }
  assert {
    condition     = google_project.environment["isolation"].deletion_policy == "DELETE" && google_storage_bucket.terraform_state["isolation"].project == "stara-test-isolation" && length(google_storage_bucket.terraform_state) == 3
    error_message = "The temporary isolation project must have its own protected state bucket and controlled project teardown policy."
  }
  assert {
    condition     = toset(google_billing_budget.combined.budget_filter[0].projects) == toset(["projects/900000000001", "projects/900000000002", "projects/900000000003"])
    error_message = "The temporary isolation drill must remain included in the combined budget."
  }
}

run "reject_empty_private_organization" {
  command = plan
  variables { organization_id = "" }
  expect_failures = [var.organization_id]
}

run "reject_empty_private_billing" {
  command = plan
  variables { billing_account_id = "" }
  expect_failures = [var.billing_account_id]
}

run "reject_duplicate_project_ids" {
  command = plan
  variables {
    project_ids = { delivery = "stara-test-delivery", staging = "stara-test-delivery" }
  }
  expect_failures = [var.project_ids]
}

run "reject_production_project" {
  command = plan
  variables {
    project_ids = { delivery = "stara-test-delivery", staging = "stara-production" }
  }
  expect_failures = [var.project_ids]
}

run "reject_unsafe_project_id" {
  command = plan
  variables {
    project_ids = { delivery = "stara-test-delivery", staging = "../outside" }
  }
  expect_failures = [var.project_ids]
}

run "reject_foreign_region" {
  command = plan
  variables { region = "europe-west1" }
  expect_failures = [var.region]
}

run "reject_invalid_notification_channel" {
  command = plan
  variables { budget_notification_channels = ["https://untrusted.invalid/channel"] }
  expect_failures = [var.budget_notification_channels]
}
