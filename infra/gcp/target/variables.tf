variable "project_id" {
  description = "This target's private bootstrap project output."
  type        = string
  nullable    = false
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id)) && !can(regex("(^|-)(prod|production)(-|$)", var.project_id))
    error_message = "Supply a valid non-production target project."
  }
}

variable "delivery_project_id" {
  description = "Delivery project containing the shared immutable application images and artifacts."
  type        = string
  nullable    = false
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.delivery_project_id)) && var.delivery_project_id != var.project_id && !can(regex("(^|-)(prod|production)(-|$)", var.delivery_project_id))
    error_message = "Delivery and target must be distinct non-production projects."
  }
}

variable "environment" {
  type     = string
  nullable = false
  validation {
    condition     = contains(["staging", "isolation"], var.environment)
    error_message = "Only staging and temporary isolation targets are supported."
  }
}

variable "region" {
  type    = string
  default = "us-central1"
  validation {
    condition     = var.region == "us-central1"
    error_message = "Targets are restricted to us-central1."
  }
}

variable "enable_load_balancer" {
  type        = bool
  default     = true
  description = "Set false for the temporary isolation target."
  validation {
    condition     = !var.enable_load_balancer || var.environment == "staging"
    error_message = "Only staging can have a load balancer."
  }
}

variable "hostname" {
  type    = string
  default = "staging.app.stara.co"
  validation {
    condition     = var.hostname == "staging.app.stara.co"
    error_message = "Only the approved staging hostname may be configured."
  }
}

variable "iap_users" {
  description = "Explicit individual in-organization user:email principals supplied privately. Required when the load balancer is enabled."
  type        = set(string)
  default     = []
  validation {
    condition     = (!var.enable_load_balancer || length(var.iap_users) > 0) && alltrue([for member in var.iap_users : can(regex("^user:[^ @*\r\n]+@[^ @*\r\n]+[.][^ @*\r\n]+$", member))])
    error_message = "An enabled load balancer requires an explicit individual user allowlist."
  }
}

variable "initial_images" {
  description = "Independently verified non-root web/API image digests used for initial provisioning."
  type = object({
    web = string
    api = string
  })
  nullable = false
  validation {
    condition = alltrue([
      for component, image in var.initial_images :
      can(regex("^us-central1-docker[.]pkg[.]dev/${var.delivery_project_id}/app/${component}@sha256:[0-9a-f]{64}$", image))
    ])
    error_message = "Both images must use full SHA-256 digests in the delivery application's matching web/API repository path."
  }
}

variable "artifact_bucket" {
  description = "Private bootstrap/delivery wiring; the executor may only read published candidate artifacts."
  type        = string
  nullable    = false
  validation {
    condition     = var.artifact_bucket == "${var.delivery_project_id}-release-artifacts"
    error_message = "Use only the configured delivery artifact bucket."
  }
}

variable "staging_executor_service_account" {
  description = "Private delivery executor output. Isolation instead creates its own local executor identity."
  type        = string
  default     = null
  nullable    = true
  validation {
    condition     = var.environment == "isolation" ? var.staging_executor_service_account == null : var.staging_executor_service_account == "stara-executor@${var.delivery_project_id}.iam.gserviceaccount.com"
    error_message = "Staging requires its exact delivery executor; isolation must not reuse staging's executor."
  }
}

variable "bootstrap_state_backup_path" {
  description = "Absolute private backup path, created and checked before any target plan/apply. Never the active bootstrap state file."
  type        = string
  sensitive   = true
  nullable    = false
  validation {
    condition = (
      can(regex("^([A-Za-z]:[/\\\\]|/)", var.bootstrap_state_backup_path)) &&
      abspath(var.bootstrap_state_backup_path) != abspath("${path.module}/../../../.artifacts/private/bootstrap/terraform.tfstate") &&
      try(filesha256(var.bootstrap_state_backup_path) == var.bootstrap_state_sha256, false)
    )
    error_message = "A separate readable private bootstrap-state backup must exist and match the recorded source-state SHA-256 before planning this target."
  }
}

variable "bootstrap_state_sha256" {
  description = "SHA-256 measured from the current private bootstrap state before making its independent backup."
  type        = string
  sensitive   = true
  nullable    = false
  validation {
    condition     = can(regex("^[0-9a-f]{64}$", var.bootstrap_state_sha256))
    error_message = "Supply the privately recorded current bootstrap-state SHA-256."
  }
}
