variable "organization_id" {
  description = "Owner-supplied organization number, provided only through private inputs."
  type        = string
  sensitive   = true
  nullable    = false
  validation {
    condition     = can(regex("^[1-9][0-9]+$", var.organization_id))
    error_message = "Supply the owning organization's numeric identity privately."
  }
}

variable "billing_account_id" {
  description = "Owner-supplied billing account, never a checked-in default."
  type        = string
  sensitive   = true
  nullable    = false
  validation {
    condition     = can(regex("^[A-Z0-9]{6}-[A-Z0-9]{6}-[A-Z0-9]{6}$", var.billing_account_id))
    error_message = "Supply a valid owner-approved billing account privately."
  }
}

variable "project_ids" {
  description = "New owner-approved project IDs. Omit isolation unless conducting the temporary isolation drill."
  type = object({
    delivery  = string
    staging   = string
    isolation = optional(string)
  })
  nullable = false
  validation {
    condition = alltrue([
      for id in values(var.project_ids) : id == null ? true : (
        can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", id)) &&
        !can(regex("(^|-)(prod|production)(-|$)", id))
      )
    ])
    error_message = "Use valid non-production project IDs."
  }
  validation {
    condition     = length(distinct(compact(values(var.project_ids)))) == length(compact(values(var.project_ids)))
    error_message = "Every enabled environment must use a distinct project."
  }
}

variable "region" {
  type    = string
  default = "us-central1"
  validation {
    condition     = var.region == "us-central1"
    error_message = "This evaluation is restricted to us-central1."
  }
}

variable "budget_notification_channels" {
  description = "Optional privately supplied existing email channel resource names; billing-owner notifications remain enabled."
  type        = list(string)
  default     = []
  validation {
    condition     = length(var.budget_notification_channels) <= 5 && alltrue([for name in var.budget_notification_channels : can(regex("^projects/[^/]+/notificationChannels/[^/]+$", name))])
    error_message = "Supply at most five valid private Monitoring notification channel names."
  }
}
