variable "project_id" {
  description = "Private bootstrap output for the delivery project."
  type        = string
  nullable    = false
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id)) && !can(regex("(^|-)(prod|production)(-|$)", var.project_id))
    error_message = "Supply a valid non-production delivery project."
  }
}

variable "staging_project_id" {
  description = "The sole dispatch target, provided privately from bootstrap."
  type        = string
  nullable    = false
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.staging_project_id)) && var.staging_project_id != var.project_id && !can(regex("(^|-)(prod|production)(-|$)", var.staging_project_id))
    error_message = "Staging must be a distinct valid non-production project."
  }
}

variable "region" {
  type    = string
  default = "us-central1"
  validation {
    condition     = var.region == "us-central1"
    error_message = "Delivery is restricted to us-central1."
  }
}

variable "executor_image" {
  description = "Owner-reviewed control image containing the fixed Node CLI and gh 2.100.0; published separately by the private owner."
  type        = string
  nullable    = false
  validation {
    condition     = can(regex("^us-central1-docker[.]pkg[.]dev/${var.project_id}/control/executor@sha256:[0-9a-f]{64}$", var.executor_image))
    error_message = "Pin the reviewed executor image by SHA-256 in this delivery project's control repository."
  }
}

variable "enable_dispatch" {
  description = "Enable only after the reviewed control image, target, config, DNS, IAP and private alerts are verified."
  type        = bool
  default     = false
  nullable    = false
}

variable "operator_email" {
  description = "Private owner email for corrective incidents. Never include this input in public evidence."
  type        = string
  sensitive   = true
  nullable    = false
  validation {
    condition     = can(regex("^[^ @\r\n]+@[^ @\r\n]+[.][^ @\r\n]+$", var.operator_email))
    error_message = "A private owner notification email is required."
  }
}
