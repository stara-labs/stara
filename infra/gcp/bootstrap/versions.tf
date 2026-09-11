terraform {
  required_version = "= 1.16.2"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "= 8.2.0"
    }
  }

  backend "local" {
    path = "../../../.artifacts/private/bootstrap/terraform.tfstate"
  }
}

provider "google" {
  region = var.region
}

provider "google" {
  alias                 = "budget"
  project               = var.project_ids.delivery
  billing_project       = var.project_ids.delivery
  user_project_override = true
  region                = var.region
}
