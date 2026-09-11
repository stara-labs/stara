locals {
  projects = { for environment, id in var.project_ids : environment => id if id != null }
  common_apis = [
    "cloudresourcemanager.googleapis.com",
    "compute.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "serviceusage.googleapis.com",
    "storage.googleapis.com",
  ]
  delivery_apis = [
    "artifactregistry.googleapis.com",
    "billingbudgets.googleapis.com",
    "cloudbilling.googleapis.com",
    "cloudbuild.googleapis.com",
    "pubsub.googleapis.com",
    "sts.googleapis.com",
  ]
  target_apis = [
    "artifactregistry.googleapis.com",
    "certificatemanager.googleapis.com",
    "iap.googleapis.com",
    "run.googleapis.com",
  ]
  api_bindings = merge([
    for environment, id in local.projects : {
      for api in concat(local.common_apis, environment == "delivery" ? local.delivery_apis : local.target_apis) :
      "${environment}/${api}" => { environment = environment, api = api }
    }
  ]...)
}

resource "google_project" "environment" {
  for_each            = local.projects
  project_id          = each.value
  name                = "Stara ${each.key}"
  org_id              = var.organization_id
  billing_account     = var.billing_account_id
  auto_create_network = false
  deletion_policy     = each.key == "isolation" ? "DELETE" : "PREVENT"
  labels = {
    application = "stara"
    environment = each.key
    data_class  = "synthetic"
  }
}

resource "google_project_service" "api" {
  for_each                   = local.api_bindings
  project                    = google_project.environment[each.value.environment].project_id
  service                    = each.value.api
  disable_on_destroy         = false
  disable_dependent_services = false
}

resource "google_storage_bucket" "terraform_state" {
  for_each                    = local.projects
  project                     = google_project.environment[each.key].project_id
  name                        = "${each.value}-tfstate"
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

resource "google_billing_budget" "combined" {
  provider        = google.budget
  billing_account = var.billing_account_id
  display_name    = "Stara restricted staging and temporary isolation"
  budget_filter {
    projects        = [for project in google_project.environment : "projects/${project.number}"]
    calendar_period = "MONTH"
  }
  amount {
    specified_amount {
      currency_code = "USD"
      units         = "100"
    }
  }
  threshold_rules {
    threshold_percent = 0.5
    spend_basis       = "CURRENT_SPEND"
  }
  threshold_rules {
    threshold_percent = 0.8
    spend_basis       = "CURRENT_SPEND"
  }
  threshold_rules {
    threshold_percent = 1.0
    spend_basis       = "CURRENT_SPEND"
  }
  all_updates_rule {
    disable_default_iam_recipients   = false
    monitoring_notification_channels = var.budget_notification_channels
  }
  depends_on = [google_project_service.api]
}
